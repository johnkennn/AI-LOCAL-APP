import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

type Doc = { id: string; name: string; content: string };

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

function splitText(text: string, chunkSize = 900, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < clean.length; start += step) {
    const end = Math.min(clean.length, start + chunkSize);
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
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
      docName: string;
      chunk: string;
      score: number;
    }> = [];

    for (const doc of docs) {
      const chunks = splitText(doc.content ?? '', safeChunkSize, safeOverlap);
      for (const chunk of chunks) {
        const vec = await embed(chunk, embeddingModel);
        scored.push({
          docName: doc.name,
          chunk,
          score: cosineSimilarity(qVec, vec),
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

