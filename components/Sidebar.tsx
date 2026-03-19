'use client';

import type { Conversation } from '@/lib/types';

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

/**
 * Sidebar：会话侧边栏（创建/切换/删除）。
 * 注意：删除按钮的 click 会 stopPropagation，避免触发“选中会话”。
 */
export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onCreate,
  onDelete,
}: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {/* 新建会话：仅触发 UI 事件，真正持久化在 page.tsx 的回调中完成 */}
      <button
        type="button"
        onClick={onCreate}
        className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
      >
        <span className="text-lg">+</span>
        新建对话
      </button>
      <nav className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
            暂无对话
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <div
                  role="button"
                  tabIndex={0}
                  // 支持键盘可达性：Enter/空格选中会话
                  onClick={() => onSelect(conv.id)}
                  onKeyDown={(e) =>
                    (e.key === 'Enter' || e.key === ' ') && onSelect(conv.id)
                  }
                  className={`group flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                    currentId === conv.id
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate" title={conv.title}>
                    {conv.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => onDelete(conv.id, e)}
                    // 视觉上默认隐藏（hover 才出现），避免侧边栏噪音过大
                    className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-opacity"
                    aria-label="删除对话"
                    title="删除"
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
      </nav>
    </aside>
  );
}
