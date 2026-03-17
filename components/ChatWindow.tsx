'use client';

import { MarkdownContent } from '@/components/MarkdownContent';

interface Message {
  role: string;
  content: string;
}

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  fileName: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearFile: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function ChatWindow({
  messages,
  isLoading,
  input,
  onInputChange,
  onSend,
  fileName,
  onFileChange,
  onClearFile,
  onKeyDown,
}: ChatWindowProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
      {/* 聊天区域 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    m.role === 'user'
                      ? 'bg-blue-500 text-white rounded-br-md shadow-sm'
                      : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md shadow-sm border border-zinc-100 dark:border-zinc-700'
                  }`}
                >
                  {m.role === 'user' ? (
                    <span className="whitespace-pre-wrap break-words text-sm">
                      {m.content}
                    </span>
                  ) : (
                    <MarkdownContent content={m.content} />
                  )}
                </div>
              </div>
            ))}
            {isLoading &&
              (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-white dark:bg-zinc-800 px-4 py-2.5 shadow-sm border border-zinc-100 dark:border-zinc-700">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400 animate-pulse">
                      思考中...
                    </span>
                  </div>
                </div>
              )}
            {messages.length === 0 && !isLoading && (
              <div className="py-16 text-center">
                <p className="text-zinc-400 dark:text-zinc-500 text-sm">
                  输入消息开始对话，支持 Markdown 与代码高亮
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部输入栏 */}
      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-2">
          {fileName && (
            <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <span className="truncate">已挂载文档：{fileName}</span>
              <button
                type="button"
                onClick={onClearFile}
                className="ml-3 text-[11px] hover:underline"
              >
                移除
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <input
              className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-shadow"
              placeholder="输入消息..."
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={isLoading}
            />
            <button
              onClick={onSend}
              disabled={isLoading}
              className="shrink-0 rounded-xl bg-blue-500 px-6 py-3 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {isLoading ? '...' : '发送'}
            </button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                选择本地文档（.txt / .md / .pdf）
              </span>
              <input
                type="file"
                accept=".txt,.md,.pdf"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
