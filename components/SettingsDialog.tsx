'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ModelSelect } from '@/components/ModelSelect';

const EMBEDDING_MODELS = [
  { id: 'mxbai-embed-large', name: 'mxbai-embed-large' },
  { id: 'nomic-embed-text', name: 'nomic-embed-text' },
];

interface SettingsDialogProps {
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  ragEnabled: boolean;
  setRagEnabled: (v: boolean) => void;
  ragTopK: number;
  setRagTopK: (v: number) => void;
  ragChunkSize: number;
  setRagChunkSize: (v: number) => void;
  ragOverlap: number;
  setRagOverlap: (v: number) => void;
  embeddingModel: string;
  setEmbeddingModel: (v: string) => void;
  ragError: string | null;
  numCtx: number;
  setNumCtx: (v: number) => void;
}

/**
 * SettingsDialog：集中管理“系统提示词 + RAG 参数 + num_ctx”等设置项。
 * 这些设置属于轻量状态，持久化由 `app/page.tsx` 负责（localStorage settings 层）。
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const {
    systemPrompt,
    setSystemPrompt,
    ragEnabled,
    setRagEnabled,
    ragTopK,
    setRagTopK,
    ragChunkSize,
    setRagChunkSize,
    ragOverlap,
    setRagOverlap,
    embeddingModel,
    setEmbeddingModel,
    ragError,
    numCtx,
    setNumCtx,
  } = props;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="系统设定"
        >
          ⚙ 设置
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl">
          {/* Radix a11y：DialogContent 需要 Description；此处用 sr-only 供读屏使用 */}
          <Dialog.Description className="sr-only">
            设置系统提示词、RAG 检索参数与上下文窗口
          </Dialog.Description>
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
            <Dialog.Title className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              设置
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="关闭"
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="max-h-[70vh] overflow-auto px-5 py-4 space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                系统提示词
              </div>
              <input
                type="text"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="如：你是一个精通 JavaScript 的架构师"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={ragEnabled}
                    onChange={(e) => setRagEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  启用 RAG（切片检索注入）
                </label>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-400">Embedding</span>
                  <div className="w-56">
                    <ModelSelect
                      value={embeddingModel}
                      onChange={setEmbeddingModel}
                      options={EMBEDDING_MODELS}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>TopK</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={ragTopK}
                    onChange={(e) =>
                      setRagTopK(Math.max(1, Number(e.target.value || 1)))
                    }
                    className="w-16 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>Chunk</span>
                  <input
                    type="number"
                    min={300}
                    max={2000}
                    step={50}
                    value={ragChunkSize}
                    onChange={(e) =>
                      setRagChunkSize(Math.max(300, Number(e.target.value || 900)))
                    }
                    className="w-20 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>Overlap</span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    step={10}
                    value={ragOverlap}
                    onChange={(e) =>
                      setRagOverlap(Math.max(0, Number(e.target.value || 150)))
                    }
                    className="w-20 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>

              {ragError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                  RAG 错误：{ragError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  上下文窗口（num_ctx）
                </div>
                <div className="text-xs text-zinc-400">
                  越大越能“记住”长文档，但更耗内存/更慢
                </div>
              </div>
              <input
                type="number"
                min={1024}
                step={512}
                value={numCtx}
                onChange={(e) => setNumCtx(Math.max(1024, Number(e.target.value || 0)))}
                className="w-28 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800 px-5 py-4">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                关闭
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

