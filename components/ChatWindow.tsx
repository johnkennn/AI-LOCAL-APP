'use client';

import { MarkdownContent } from '@/components/MarkdownContent';
import type { DocItem } from '@/lib/types';

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
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  docs: DocItem[];
  activeDocId: string | null;
  onSetActiveDoc: (id: string) => void;
  onToggleDoc: (id: string) => void;
  onRemoveDoc: (id: string) => void;
  isContextTooLong: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function ChatWindow({
  messages,
  isLoading,
  input,
  onInputChange,
  onSend,
  onFileChange,
  docs,
  activeDocId,
  onSetActiveDoc,
  onToggleDoc,
  onRemoveDoc,
  isContextTooLong,
  onKeyDown,
}: ChatWindowProps) {
  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null;
  return (
    <div className="flex min-h-0 flex-1 min-w-0 overflow-hidden">
      {/* 左侧：聊天 */}
      <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
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
                (messages.length === 0 ||
                  messages[messages.length - 1]?.role === 'user') && (
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

        {/* 底部输入栏（不遮挡消息区） */}
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4">
          <div className="mx-auto max-w-3xl space-y-2">
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
            <div className="text-[11px] text-zinc-400">
              Enter 发送 · 右侧勾选的文档会注入上下文
            </div>
          </div>
        </div>
      </div>

      {/* 右侧：文档列表与预览 */}
      <aside className="hidden lg:flex w-96 shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              已上传文档
            </div>
            <label className="cursor-pointer rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              + 添加
              <input
                type="file"
                accept=".txt,.md,.pdf"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
          </div>
          {isContextTooLong && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              内容过长（已选文档超 5000 字），建议在设置中开启 RAG 模式
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {docs.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-400">
              还没有上传文档
            </div>
          ) : (
            <ul className="space-y-1">
              {docs.map((d) => (
                <li key={d.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
                      activeDocId === d.id
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                    onClick={() => onSetActiveDoc(d.id)}
                  >
                    <input
                      type="checkbox"
                      checked={d.checked}
                      onChange={() => onToggleDoc(d.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                      aria-label="勾选注入上下文"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm text-zinc-800 dark:text-zinc-100"
                        title={d.name}
                      >
                        {d.name}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {d.kind.toUpperCase()} · {d.content.length} 字
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveDoc(d.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-400 hover:text-red-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-opacity"
                      title="删除"
                      aria-label="删除文档"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 flex-1 border-t border-zinc-200 dark:border-zinc-800">
          <div className="px-4 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            预览
          </div>
          <div className="h-[calc(100%-2.25rem)] px-2 pb-2">
            {!activeDoc ? (
              <div className="h-full rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-center text-xs text-zinc-400">
                点击上面已上传文档以查看内容
              </div>
            ) : activeDoc.kind === 'pdf' && activeDoc.objectUrl ? (
              <iframe
                title={activeDoc.name}
                src={activeDoc.objectUrl}
                className="h-full w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white"
              />
            ) : (
              <div className="h-full overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
                <pre className="whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-200">
                  {activeDoc.content.slice(0, 20000)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
