import { db, now, type StoredEmbedding } from '@/lib/storage/db';

/**
 * 读取 embedding 缓存。
 * - key = sha256(model + '\n' + prompt)
 * - 命中则避免再次调用本机 Ollama embeddings（显著加速 RAG）
 */
export async function getEmbedding(key: string): Promise<number[] | null> {
  const row = await db.embeddings.get(key);
  return row?.embedding ?? null;
}

/**
 * 写入 embedding 缓存。
 * 注意：embedding 是浮点数组，体积较大，建议配合 prune 控制上限。
 */
export async function putEmbedding(params: {
  key: string;
  model: string;
  embedding: number[];
}): Promise<void> {
  const row: StoredEmbedding = {
    key: params.key,
    model: params.model,
    dim: params.embedding.length,
    embedding: params.embedding,
    createdAt: now(),
  };
  await db.embeddings.put(row);
}

/**
 * 控制 embedding 缓存规模，保留最近 keepLatest 条。
 * 这是一个“容量保护阀”，防止长期使用导致 IndexedDB 膨胀过快。
 */
export async function pruneEmbeddings(keepLatest: number): Promise<void> {
  if (keepLatest <= 0) return;
  const total = await db.embeddings.count();
  if (total <= keepLatest) return;
  const toDelete = await db.embeddings
    .orderBy('createdAt')
    .limit(total - keepLatest)
    .toArray();
  await db.embeddings.bulkDelete(toDelete.map((r) => r.key));
}

