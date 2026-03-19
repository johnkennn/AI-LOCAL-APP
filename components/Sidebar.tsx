'use client';

import type { Conversation } from '@/lib/types';

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

/**
 * Sidebar：会话侧边栏（创建/切换/删除）。
 * 支持收起/展开：collapsed 时显示窄条与展开按钮。
 */
export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onCreate,
  onDelete,
  collapsed = false,
  onToggle,
}: SidebarProps) {
  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-[width] duration-200 ease-out ${
        collapsed ? 'w-12' : 'w-64'
      }`}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center justify-center py-4 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          title="展开会话栏"
          aria-label="展开会话栏"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between shrink-0 px-2 py-2 border-b border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onCreate}
              className="flex flex-1 items-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 px-3 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
            >
              <span className="text-lg">+</span>
              新建对话
            </button>
            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                className="rounded p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300"
                title="收起会话栏"
                aria-label="收起会话栏"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}
          </div>
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
                        className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-opacity"
                        aria-label="删除对话"
                        title="删除"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
        </>
      )}
    </aside>
  );
}
