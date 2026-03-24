import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { VideoPipelineResult } from "@/lib/video/types";

type StoredVideoPipelineRecord = {
  id: string;
  createdAt: string;
  cacheKey?: string;
  result: VideoPipelineResult;
};

type CacheIndex = Record<string, string>;

function getStoreDir(): string {
  return path.join(os.homedir(), ".ai-local-app", "video-pipeline-records");
}

function toRecordPath(id: string): string {
  return path.join(getStoreDir(), `${id}.json`);
}

function toCacheIndexPath(): string {
  return path.join(getStoreDir(), "cache-index.json");
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(getStoreDir(), { recursive: true });
}

/**
 * 持久化保存一次视频流水线结果，便于后续复用和查询。
 */
export async function saveVideoPipelineRecord(
  id: string,
  result: VideoPipelineResult,
  cacheKey?: string
): Promise<StoredVideoPipelineRecord> {
  await ensureStoreDir();
  const record: StoredVideoPipelineRecord = {
    id,
    createdAt: new Date().toISOString(),
    cacheKey: cacheKey?.trim() || undefined,
    result,
  };
  await fs.writeFile(toRecordPath(id), JSON.stringify(record, null, 2), "utf8");
  if (record.cacheKey) {
    await upsertCacheIndex(record.cacheKey, id);
  }
  return record;
}

/**
 * 按记录 ID 读取已持久化的视频分析结果。
 */
export async function getVideoPipelineRecord(
  id: string
): Promise<StoredVideoPipelineRecord | null> {
  try {
    const content = await fs.readFile(toRecordPath(id), "utf8");
    return JSON.parse(content) as StoredVideoPipelineRecord;
  } catch {
    return null;
  }
}

async function readCacheIndex(): Promise<CacheIndex> {
  try {
    const content = await fs.readFile(toCacheIndexPath(), "utf8");
    const parsed = JSON.parse(content) as CacheIndex | null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

async function upsertCacheIndex(cacheKey: string, id: string): Promise<void> {
  const index = await readCacheIndex();
  index[cacheKey] = id;
  await fs.writeFile(toCacheIndexPath(), JSON.stringify(index, null, 2), "utf8");
}

/**
 * 通过缓存键读取历史记录（命中则可直接复用结果）。
 */
export async function getVideoPipelineRecordByCacheKey(
  cacheKey: string
): Promise<StoredVideoPipelineRecord | null> {
  const key = cacheKey.trim();
  if (!key) return null;
  const index = await readCacheIndex();
  const id = index[key];
  if (!id) return null;
  return getVideoPipelineRecord(id);
}
