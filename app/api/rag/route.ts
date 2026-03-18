import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

type Doc = {
  id: string;
  name: string;
  content: string;
  kind?: 'txt' | 'md' | 'pdf';
  pages?: Array<{ page: number; text: string }>;
};

// embedding 模型的上下文通常较短；字符数过大容易触发
// {"error":"the input length exceeds the context length"}
const MAX_EMBED_CHARS = 1500;
const MAX_CHUNK_SIZE = 1000;

function clampInt(n: number, min: number, max: number) {
  const v = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, v));
}

function safeForEmbedding(text: string): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= MAX_EMBED_CHARS) return clean;
  return clean.slice(0, MAX_EMBED_CHARS);
}

type Block = {
  text: string;
  heading?: string;
  page?: number;
};

type Chunk = {
  text: string;
  heading?: string;
  pageStart?: number;
  pageEnd?: number;
};

function splitParagraphs(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n');
  // 优先按空行分段；如果没有空行，再按句号/分号等粗切
  const byBlank = clean
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byBlank.length >= 2) return byBlank;
  return clean
    .split(/(?<=[。！？!?；;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function blocksFromMd(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let currentHeading: string | undefined;
  let buf: string[] = [];

  const flush = () => {
    const joined = buf.join('\n').trim();
    if (joined) {
      for (const p of splitParagraphs(joined)) {
        blocks.push({ text: p, heading: currentHeading });
      }
    }
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (m) {
      flush();
      currentHeading = m[2].trim().slice(0, 60);
      continue;
    }
    buf.push(line);
  }
  flush();
  return blocks;
}

function blocksFromTxt(text: string): Block[] {
  return splitParagraphs(text).map((p) => ({ text: p }));
}

function blocksFromPdfPages(pages: Array<{ page: number; text: string }>): Block[] {
  const blocks: Block[] = [];
  for (const p of pages) {
    for (const para of splitParagraphs(p.text || '')) {
      blocks.push({ text: para, page: p.page });
    }
  }
  return blocks;
}

function buildChunks(blocks: Block[], chunkSize: number, overlapChars: number): Chunk[] {
  if (blocks.length === 0) return [];
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < blocks.length) {
    let size = 0;
    const start = i;
    let heading: string | undefined;
    let pageStart: number | undefined;
    let pageEnd: number | undefined;
    const parts: string[] = [];

    while (i < blocks.length) {
      const b = blocks[i];
      const t = b.text.trim();
      if (!t) {
        i += 1;
        continue;
      }
      const add = (parts.length === 0 ? 0 : 2) + t.length;
      if (parts.length > 0 && size + add > chunkSize) break;
      parts.push(t);
      size += add;
      heading ||= b.heading;
      if (typeof b.page === 'number') {
        pageStart ??= b.page;
        pageEnd = b.page;
      }
      i += 1;
      if (size >= chunkSize) break;
    }

    const text = parts.join('\n\n').trim();
    if (text) chunks.push({ text, heading, pageStart, pageEnd });

    // overlap：按字符预算回退若干 blocks
    if (i >= blocks.length) break;
    if (overlapChars <= 0) continue;
    let back = 0;
    let backChars = 0;
    for (let j = i - 1; j >= start; j -= 1) {
      backChars += blocks[j].text.length;
      back += 1;
      if (backChars >= overlapChars) break;
    }
    i = Math.max(start + 1, i - back);
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const embeddingCache = new Map<string, number[]>();

async function embed(prompt: string, model: string): Promise<number[]> {
  const base = safeForEmbedding(prompt);
  const attempts = [base, base.slice(0, 800), base.slice(0, 400), base.slice(0, 200)].filter(
    (v, i, arr) => v && arr.indexOf(v) === i,
  );

  let lastErr: string | null = null;
  for (const safePrompt of attempts) {
    const key = crypto
      .createHash('sha256')
      .update(`${model}\n${safePrompt}`)
      .digest('hex');
    const cached = embeddingCache.get(key);
    if (cached) return cached;

    const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: safePrompt }),
    });

    if (res.ok) {
      const data = (await res.json()) as { embedding: number[] };
      embeddingCache.set(key, data.embedding);
      return data.embedding;
    }

    const text = await res.text().catch(() => '');
    lastErr = `embeddings 请求失败: ${res.status}${text ? ` - ${text}` : ''}`;
    // 如果是“上下文太长”，继续用更短的 prompt 重试；否则直接失败
    if (!text.includes('exceeds the context length')) {
      break;
    }
  }

  throw new Error(lastErr ?? 'embeddings 请求失败');
}

export async function POST(req: Request) {
  try {
    const {
      query,
      docs,
      topK = 4,
      chunkSize = 900,
      overlap = 150,
      embeddingModel = 'mxbai-embed-large',
    } = (await req.json()) as {
      query: string;
      docs: Doc[];
      topK?: number;
      chunkSize?: number;
      overlap?: number;
      embeddingModel?: string;
    };

    if (!query?.trim()) {
      return NextResponse.json({ error: 'query 不能为空' }, { status: 400 });
    }
    if (!docs?.length) {
      return NextResponse.json({ error: 'docs 不能为空' }, { status: 400 });
    }

    const safeChunkSize = clampInt(chunkSize, 200, MAX_CHUNK_SIZE);
    const safeOverlap = clampInt(overlap, 0, Math.floor(safeChunkSize / 2));
    const safeTopK = clampInt(topK, 1, 10);

    const qVec = await embed(query.trim(), embeddingModel);

    const scored: Array<{
      docId: string;
      docName: string;
      chunk: string;
      score: number;
      pageStart?: number;
      pageEnd?: number;
      heading?: string;
    }> = [];

    for (const doc of docs) {
      const kind = doc.kind ?? 'txt';
      const blocks =
        kind === 'pdf' && doc.pages?.length
          ? blocksFromPdfPages(doc.pages)
          : kind === 'md'
            ? blocksFromMd(doc.content ?? '')
            : blocksFromTxt(doc.content ?? '');

      const chunks = buildChunks(blocks, safeChunkSize, safeOverlap);
      for (const ch of chunks) {
        const vec = await embed(ch.text, embeddingModel);
        scored.push({
          docId: doc.id,
          docName: doc.name,
          chunk: ch.text,
          score: cosineSimilarity(qVec, vec),
          pageStart: ch.pageStart,
          pageEnd: ch.pageEnd,
          heading: ch.heading,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return NextResponse.json({ chunks: scored.slice(0, safeTopK) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

