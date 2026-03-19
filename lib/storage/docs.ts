import type { DocItem } from '@/lib/types';
import { db, now, type StoredDoc } from '@/lib/storage/db';

/**
 * 为文档写入补齐 createdAt/updatedAt：
 * - createdAt 首次写入后保持不变
 * - updatedAt 用于“最近上传/最近修改”排序
 */
function withTimestamps(d: StoredDoc, existing?: StoredDoc | null): StoredDoc {
  const ts = now();
  return {
    ...d,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
}

/** 读取全部文档（按 updatedAt 倒序），用于启动恢复“已上传文档”。 */
export async function getAllDocs(): Promise<StoredDoc[]> {
  return await db.documents.orderBy('updatedAt').reverse().toArray();
}

/**
 * 新增或更新单个文档。
 * 写入点：上传/勾选 checked 切换/解析得到 pages/删除重传等。
 */
export async function upsertDoc(doc: StoredDoc): Promise<void> {
  const existing = (await db.documents.get(doc.id)) ?? null;
  await db.documents.put(withTimestamps(doc, existing));
}

/** 删除文档（用于右侧列表删除）。 */
export async function removeDoc(id: string): Promise<void> {
  await db.documents.delete(id);
}

/**
 * 全量替换文档（预留：未来可用于迁移或导入导出）。
 * 用事务保证一致性。
 */
export async function replaceAllDocs(docs: StoredDoc[]): Promise<void> {
  await db.transaction('rw', db.documents, async () => {
    await db.documents.clear();
    const ts = now();
    const rows = docs.map((d) => ({
      ...d,
      createdAt: ts,
      updatedAt: ts,
    }));
    if (rows.length) await db.documents.bulkPut(rows);
  });
}

/**
 * 将存储形态（StoredDoc）转换为 UI 使用的 DocItem。
 * - PDF 的 objectUrl 不能持久化：刷新后需要 blob 重建，才能继续 iframe 预览与页码跳转。
 */
export function toDocItem(stored: StoredDoc): DocItem {
  const { blob, createdAt: _c, updatedAt: _u, ...rest } = stored;
  // objectUrl 只在内存里有效，不能持久化；刷新后需由 blob 重建
  const objectUrl =
    stored.kind === 'pdf' && blob ? URL.createObjectURL(blob) : undefined;
  return { ...rest, blob, objectUrl };
}

