import Dexie, { type Table } from 'dexie';

import type { Conversation, DocItem } from '@/lib/types';

/**
 * IndexedDB（通过 Dexie 封装）的 schema 定义文件。
 * 这里负责：
 * - 统一数据库名与版本升级（schema 变更）
 * - 定义各表（object stores）及索引，便于按时间/字段查询
 */
export type StoredConversation = Conversation & {
  createdAt: number;
  updatedAt: number;
};

export type StoredDoc = Omit<DocItem, 'objectUrl'> & {
  createdAt: number;
  updatedAt: number;
  /**
   * 仅用于 pdf 预览持久化。txt/md 不需要。
   * objectUrl 会在读取时基于 blob 重新创建。
   */
  blob?: Blob;
};

export type StoredEmbedding = {
  key: string; // sha256(model + '\n' + prompt)
  model: string;
  dim: number;
  embedding: number[];
  createdAt: number;
};

/**
 * 本项目的 IndexedDB 数据库封装。
 * - v1：只存 conversations
 * - v2：新增 documents（含 pdf blob）与 embeddings（向量缓存）
 *
 * 注意：Dexie 的 version 升级用于 schema 演进；一旦发布后不要随意修改旧版本 stores 定义。
 */
class AiLocalAppDB extends Dexie {
  conversations!: Table<StoredConversation, string>;
  documents!: Table<StoredDoc, string>;
  embeddings!: Table<StoredEmbedding, string>;

  constructor() {
    super('ai-local-app');
    this.version(1).stores({
      conversations: 'id, updatedAt',
    });
    this.version(2).stores({
      conversations: 'id, updatedAt',
      documents: 'id, updatedAt, kind, name, checked',
      embeddings: 'key, model, createdAt',
    });
  }
}

/** 全局单例 DB（同名 DB 在浏览器里共享）。 */
export const db = new AiLocalAppDB();

/** 统一时间戳来源，用于 updatedAt/createdAt。 */
export function now() {
  return Date.now();
}

