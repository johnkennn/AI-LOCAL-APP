import type { Conversation } from '@/lib/types';
import { db, now, type StoredConversation } from '@/lib/storage/db';

/**
 * 为会话写入补齐 createdAt/updatedAt：
 * - createdAt 首次写入后保持不变
 * - updatedAt 每次更新刷新，用于“最近对话”排序
 */
function withTimestamps(c: Conversation, existing?: StoredConversation | null): StoredConversation {
  const ts = now();
  return {
    ...c,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
}

/**
 * 读取全部会话（按 updatedAt 倒序）。
 * 用于应用启动时恢复会话列表。
 */
export async function getAllConversations(): Promise<Conversation[]> {
  const rows = await db.conversations.orderBy('updatedAt').reverse().toArray();
  return rows.map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest);
}

/**
 * 新增或更新单个会话。
 * 写入点：发消息/流式更新/标题生成/删除消息等。
 */
export async function upsertConversation(conv: Conversation): Promise<void> {
  const existing = (await db.conversations.get(conv.id)) ?? null;
  await db.conversations.put(withTimestamps(conv, existing));
}

/** 删除会话（用于侧边栏删除）。 */
export async function removeConversation(id: string): Promise<void> {
  await db.conversations.delete(id);
}

/**
 * 全量替换会话（用于从 legacy localStorage 一次性迁移/重建）。
 * 用事务保证“要么全成功，要么不写入”。
 */
export async function replaceAllConversations(convs: Conversation[]): Promise<void> {
  await db.transaction('rw', db.conversations, async () => {
    await db.conversations.clear();
    const ts = now();
    const rows: StoredConversation[] = convs.map((c) => ({
      ...c,
      createdAt: ts,
      updatedAt: ts,
    }));
    if (rows.length) await db.conversations.bulkPut(rows);
  });
}

