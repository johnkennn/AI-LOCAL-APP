import type { DocItem } from '@/lib/types';
import { getEmbedding, putEmbedding, pruneEmbeddings } from '@/lib/storage/embeddings';

// embedding 模型上下文通常较短；过长容易触发 exceeds context length
const MAX_EMBED_CHARS = 1500;

type Block = { text: string; heading?: string; page?: number };
type Chunk = { text: string; heading?: string; pageStart?: number; pageEnd?: number };

export type RagHit = {
  docId: string;
  docName: string;
  chunk: string;
  score: number;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
};

/**
 * 前端本地 RAG（切片+检索都在浏览器做）的核心原因：
 * - docs 与引用信息已在 IndexedDB（含 pdf pages/pageNo），本地切片能保留页码/标题用于“论文式引用”
 * - embedding 计算昂贵且会重复：用 IndexedDB 做跨刷新缓存，命中时无需再调用 Ollama
 * - 只把“需要 embedding 的短文本”发给 /api/embed，不传整篇文档，避免服务端/网络压力
 */
function safeForEmbedding(text: string): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= MAX_EMBED_CHARS) return clean;
  return clean.slice(0, MAX_EMBED_CHARS);
}

/** 文本分段：优先按空行，其次按常见中文/英文标点粗切。 */
function splitParagraphs(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n');
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

/**
 * Markdown 结构化切片：识别 `#` 标题作为 heading，并对正文做段落切分。
 * 用途：保留“标题/段落”语义，便于引用展示。
 */
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

/** 纯文本切片：按段落拆分。 */
function blocksFromTxt(text: string): Block[] {
  return splitParagraphs(text).map((p) => ({ text: p }));
}

/**
 * PDF 切片：按页保留 page number，并按段落拆分。
 * 用途：命中后可跳转到对应页码。
 */
function blocksFromPdfPages(pages: Array<{ page: number; text: string }>): Block[] {
  const blocks: Block[] = [];
  for (const p of pages) {
    for (const para of splitParagraphs(p.text || '')) {
      blocks.push({ text: para, page: p.page });
    }
  }
  return blocks;
}

/**
 * 将 blocks 聚合成 chunk：
 * - chunkSize: 目标字符预算（不是 token，足够用于 embedding）
 * - overlapChars: 按字符预算回退，保证跨段落的上下文连续性
 */
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

/** 余弦相似度：用于 query 向量与 chunk 向量的相关性打分。 */
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

/** 浏览器端 SHA-256 hex，用于生成 embedding 缓存 key。 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * embedding 获取（带 IndexedDB 缓存）：
 * - 先查 embeddings 表
 * - 未命中再请求 /api/embed（后端转发本机 Ollama embeddings）
 */
async function embedCached(prompt: string, model: string): Promise<number[]> {
  const safe = safeForEmbedding(prompt);
  // key 绑定 model + prompt（同一段文本在不同 embedding 模型下向量不同）
  const key = await sha256Hex(`${model}\n${safe}`);
  const cached = await getEmbedding(key);
  if (cached) return cached;

  // 未命中缓存才请求后端：后端只负责转发到本机 Ollama 的 embeddings 接口，并做“超长输入重试”
  const res = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: safe }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`embeddings 请求失败: ${res.status}${text ? ` - ${text}` : ''}`);
  }
  const data = (await res.json()) as { embedding: number[] };
  await putEmbedding({ key, model, embedding: data.embedding });
  // 防止缓存无限增长：保留最近 5000 条（足够覆盖常用切片+查询）
  void pruneEmbeddings(5000).catch(() => null);
  return data.embedding;
}

/**
 * 本地 RAG 检索主函数：
 * 1) docs -> blocks -> chunks
 * 2) query/chunks 做 embedding（带缓存）
 * 3) 余弦相似度排序取 TopK
 */
export async function retrieveRagHits(params: {
  query: string;
  docs: DocItem[];
  topK: number;
  chunkSize: number;
  overlap: number;
  embeddingModel: string;
}): Promise<RagHit[]> {
  const q = params.query.trim();
  if (!q) return [];
  const selected = params.docs.filter((d) => d.checked);
  if (selected.length === 0) return [];

  // 先算 query 向量，再与每个 chunk 向量做余弦相似度
  const qVec = await embedCached(q, params.embeddingModel);
  const scored: RagHit[] = [];

  for (const doc of selected) {
    const kind = doc.kind ?? 'txt';
    const blocks =
      kind === 'pdf' && doc.pages?.length
        ? blocksFromPdfPages(doc.pages)
        : kind === 'md'
          ? blocksFromMd(doc.content ?? '')
          : blocksFromTxt(doc.content ?? '');
    const chunks = buildChunks(blocks, params.chunkSize, params.overlap);

    // 顺序执行避免并发打爆本地模型；如需加速可做并发池（但要控制 Ollama 并发）
    for (const ch of chunks) {
      const vec = await embedCached(ch.text, params.embeddingModel);
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
  return scored.slice(0, Math.max(1, Math.min(10, params.topK)));
}

