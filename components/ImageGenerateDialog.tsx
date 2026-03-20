'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';

interface ImageGenerateDialogProps {
  onGenerate: (prompt: string) => Promise<void>;
}

export function ImageGenerateDialog({ onGenerate }: ImageGenerateDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [prompt, setPrompt] = React.useState('');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onClickGenerate = async () => {
    if (isGenerating) return;
    const p = prompt.trim();
    if (!p) return;

    setIsGenerating(true);
    setError(null);
    try {
      await onGenerate(p);
      setPrompt('');
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '图片生成失败';
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm"
        >
          生成图片
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl">
          <Dialog.Description className="sr-only">图片生成面板</Dialog.Description>
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
            <Dialog.Title className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              图片生成
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="关闭"
                disabled={isGenerating}
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-3">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                {error}
              </div>
            )}
            <div className="text-xs text-zinc-500">
              例如：`一只可爱的猫，动漫风，浅色背景`
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入图片生成提示词"
              className="min-h-[120px] w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={isGenerating}
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                onClick={() => setOpen(false)}
                disabled={isGenerating}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={onClickGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? '生成中...' : '生成'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

