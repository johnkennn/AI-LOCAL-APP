'use client';

import React from 'react';
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
  ragEnabled: boolean;
  ragHits: Array<{
    docId: string;
    docName: string;
    chunk: string;
    score: number;
    pageStart?: number;
    pageEnd?: number;
    heading?: string;
  }>;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** 右侧文档栏是否展开（false 时显示窄条+展开按钮） */
  rightSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
}

/**
 * ChatWindow：主聊天窗口（左：消息 + 输入；右：文档列表 + 预览 + 引用）。
 * 这里承载 UI 交互（滚动贴底、引用点击跳页/高亮），具体数据读写由 page.tsx 负责。
 */
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
  ragEnabled,
  ragHits,
  onKeyDown,
  rightSidebarOpen,
  onToggleRightSidebar,
}: ChatWindowProps) {
  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null;
  const [pdfPage, setPdfPage] = React.useState<number | null>(null);
  const [activeHitIdx, setActiveHitIdx] = React.useState<number | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);

  /** 当前选中的命中片段（用于右侧预览高亮/跳转提示）。 */
  const activeHit =
    activeHitIdx != null && ragHits[activeHitIdx] ? ragHits[activeHitIdx] : null;

  // 若命中引用全部来自图片，则不展示“命中引用”面板，避免干扰
  const showRagHitsPanel =
    ragHits.length > 0 &&
    ragHits.some((h) => (docs.find((d) => d.id === h.docId)?.kind ?? 'txt') !== 'img');

  React.useEffect(() => {
    // 切换文档时重置跳转页，避免 iframe 无感刷新
    setPdfPage(null);
    setActiveHitIdx(null);
  }, [activeDocId]);

  React.useEffect(() => {
    // 默认停在底部：进入会话/新增消息/加载态变化时
    const el = scrollRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isLoading]);

  /** HTML 转义：用于将纯文本安全塞进 dangerouslySetInnerHTML（仅用于高亮）。 */
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');

  /**
   * 仅高亮一次命中片段，避免全文多次 mark 导致可读性下降。
   * 对于找不到完全匹配的情况，回退为不高亮（仍可用引用/跳页定位）。
   */
  const highlightOnce = (text: string, snippet: string) => {
    const s = snippet.trim().slice(0, 120);
    if (!s) return escapeHtml(text);
    const idx = text.indexOf(s);
    if (idx < 0) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const mid = escapeHtml(s);
    const after = escapeHtml(text.slice(idx + s.length));
    return `${before}<mark class="bg-yellow-200/70 dark:bg-yellow-400/30 rounded px-0.5">${mid}</mark>${after}`;
  };
  return (
    <div className="flex min-h-0 flex-1 min-w-0 overflow-hidden">
      {/* 左侧：聊天 */}
      <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            const threshold = 24;
            // 仅当用户“接近底部”时才继续自动贴底；避免阅读历史时被强制拉回底部
            const atBottom =
              el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
            stickToBottomRef.current = atBottom;
          }}
        >
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

      {/* 右侧：文档列表与预览（支持收起/展开） */}
      <aside
        className={`hidden lg:flex shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-[width] duration-200 ease-out overflow-hidden ${
          rightSidebarOpen ? 'w-96' : 'w-10'
        }`}
      >
        {rightSidebarOpen ? (
          <>
            <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                  <button
                    type="button"
                    onClick={onToggleRightSidebar}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                    title="收起文档栏"
                    aria-label="收起文档栏"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 18l6-6-6-6" />
                    </svg>
                  </button>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">已上传文档</span>
                </div>
                <label className="cursor-pointer rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0">
                  + 添加
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.mkv"
                    className="hidden"
                    onChange={onFileChange}
                  />
                </label>
              </div>
              {isContextTooLong && !ragEnabled && (
            // 仅在未开启 RAG 时提示“内容过长”，开启 RAG 后会走 TopK 注入无需该提示
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              内容过长（已选文档超 5000 字），建议在设置中开启 RAG 模式
            </div>
          )}
        </div>

        <div className="h-44 overflow-y-auto p-2">
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
                    // 点击条目切换右侧预览文档；勾选/删除按钮会 stopPropagation 避免误触切换
                    onClick={() => onSetActiveDoc(d.id)}
                  >
                    <input
                      type="checkbox"
                      checked={d.checked}
                      // checked 控制该文档是否参与上下文注入（由 page.tsx 持久化到 IndexedDB）
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
                        {d.kind.toUpperCase()} ·{' '}
                        {d.kind === 'img'
                          ? '图片'
                          : d.kind === 'video'
                            ? '视频'
                            : `${d.content.length} 字`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // 删除文档：实际删除与持久化由 page.tsx 处理
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
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              预览与引用
            </div>
            {activeDoc?.kind === 'pdf' && pdfPage && (
              <div className="text-[11px] text-zinc-400">页码：p{pdfPage}</div>
            )}
          </div>
          <div className="h-[calc(100%-2.25rem)] px-2 pb-2 flex flex-col gap-2">
            {showRagHitsPanel && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-2">
                <div className="mb-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  命中引用（点击高亮 / 跳转）
                </div>
                <div className="max-h-32 overflow-auto space-y-1">
                  {ragHits.slice(0, 8).map((h, idx) => (
                    <button
                      key={`${h.docId}-${idx}`}
                      type="button"
                      onClick={() => {
                        // “论文式引用”交互：点击命中片段 -> 切换到对应文档，并对 PDF 跳到命中页
                        setActiveHitIdx(idx);
                        onSetActiveDoc(h.docId);
                        if (h.pageStart) setPdfPage(h.pageStart);
                      }}
                      className={`w-full text-left rounded-md px-2 py-1 text-[11px] transition-colors ${
                        activeHitIdx === idx
                          ? 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700'
                          : 'hover:bg-white/60 dark:hover:bg-zinc-900/50'
                      }`}
                      title={h.docName}
                    >
                      <div className="truncate text-zinc-700 dark:text-zinc-200">
                        {h.docName}
                        {h.pageStart
                          ? ` · p${h.pageStart}${
                              h.pageEnd && h.pageEnd !== h.pageStart
                                ? `-${h.pageEnd}`
                                : ''
                            }`
                          : ''}
                        {h.heading ? ` · ${h.heading}` : ''}
                      </div>
                      <div className="truncate text-zinc-400">
                        score={h.score.toFixed(3)} · {h.chunk.slice(0, 60)}…
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!activeDoc ? (
              <div className="h-full rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-center text-xs text-zinc-400">
                点击上面已上传文档以查看内容
              </div>
            ) : activeDoc.kind === 'pdf' && activeDoc.objectUrl ? (
              <iframe
                // key 强制 remount：部分浏览器的 PDF viewer 对 #page 变化不敏感，remount 可确保跳页生效
                key={`${activeDoc.objectUrl}-${pdfPage ?? 'top'}`}
                title={activeDoc.name}
                // 通过 URL fragment #page=N 触发 PDF viewer 跳转（无需额外库）
                src={`${activeDoc.objectUrl}${pdfPage ? `#page=${pdfPage}` : ''}`}
                className="h-full w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white"
              />
            ) : activeDoc.kind === 'img' && activeDoc.objectUrl ? (
              <div className="h-full overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2">
                <img
                  src={activeDoc.objectUrl}
                  alt={activeDoc.name}
                  className="max-h-full w-full object-contain rounded"
                />
              </div>
            ) : activeDoc.kind === 'video' && activeDoc.objectUrl ? (
              <div className="h-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                <video
                  src={activeDoc.objectUrl}
                  controls
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="h-full overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
                <pre
                  className="whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-200"
                  dangerouslySetInnerHTML={{
                    // 文本/Markdown 预览区：
                    // - 默认展示转义后的纯文本（避免 XSS）
                    // - 若当前 activeHit 属于该文档，则对命中片段做一次 mark 高亮（便于定位）
                    __html:
                      activeHit && activeHit.docId === activeDoc.id
                        ? highlightOnce(
                            activeDoc.content.slice(0, 20000),
                            activeHit.chunk,
                          )
                        : escapeHtml(activeDoc.content.slice(0, 20000)),
                  }}
                />
              </div>
            )}
          </div>
        </div>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <button
              type="button"
              onClick={onToggleRightSidebar}
              className="rounded p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              title="展开文档栏"
              aria-label="展开文档栏"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
