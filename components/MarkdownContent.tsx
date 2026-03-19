'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';

import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.min.css';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * MarkdownContent：渲染 assistant 的 Markdown 输出。
 * - remarkGfm：支持表格/任务列表等 GFM 语法
 * - remarkMath + rehypeKatex：数学公式渲染
 * - rehypeHighlight：代码块语法高亮
 */
export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  const components: Components = {
    /** 代码块容器：提供滚动、背景与内边距。 */
    pre({ children }) {
      return (
        <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-200 dark:bg-zinc-800 p-4 text-sm">
          {children}
        </pre>
      );
    },
    /**
     * code 渲染：
     * - inline code：用轻量背景强调
     * - fenced code：rehype-highlight 会为其注入 className（语言高亮）
     */
    code({ className: codeClassName, children }) {
      const isInline = !codeClassName;
      if (isInline) {
        return (
          <code className="rounded bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 font-mono text-sm">
            {children}
          </code>
        );
      }
      return <code className={codeClassName}>{children}</code>;
    },
    /** 段落：控制行高与间距，避免 Markdown 输出挤在一起。 */
    p({ children }) {
      return <p className="my-1.5 leading-relaxed">{children}</p>;
    },
    /** 无序列表：统一缩进与项目符号。 */
    ul({ children }) {
      return <ul className="my-2 ml-4 list-disc">{children}</ul>;
    },
    /** 有序列表：统一缩进与编号样式。 */
    ol({ children }) {
      return <ol className="my-2 ml-4 list-decimal">{children}</ol>;
    },
    /** 列表项：轻量间距，避免过松或过挤。 */
    li({ children }) {
      return <li className="my-0.5">{children}</li>;
    },
    /** 链接：新窗口打开并加上安全属性。 */
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 underline hover:text-blue-600"
        >
          {children}
        </a>
      );
    },
    /** 引用：左侧边框 + 斜体，增强信息层级。 */
    blockquote({ children }) {
      return (
        <blockquote className="my-2 border-l-4 border-zinc-400 pl-4 italic text-zinc-600 dark:text-zinc-400">
          {children}
        </blockquote>
      );
    },
    /** 标题：限制字号避免占用过多空间。 */
    h1({ children }) {
      return <h1 className="mt-4 mb-2 text-lg font-bold">{children}</h1>;
    },
    /** 二级标题：用于段落分层。 */
    h2({ children }) {
      return <h2 className="mt-3 mb-1.5 text-base font-bold">{children}</h2>;
    },
    /** 三级标题：更细粒度的层级。 */
    h3({ children }) {
      return <h3 className="mt-2 mb-1 text-sm font-bold">{children}</h3>;
    },
    /** 表格：外层包裹横向滚动，避免小屏溢出。 */
    table({ children }) {
      return (
        <div className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse border border-zinc-300 dark:border-zinc-600">
            {children}
          </table>
        </div>
      );
    },
    /** 表头单元格：更醒目的背景与字重。 */
    th({ children }) {
      return (
        <th className="border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-700 px-3 py-2 text-left font-semibold">
          {children}
        </th>
      );
    },
    /** 表格单元格：统一边框与内边距。 */
    td({ children }) {
      return (
        <td className="border border-zinc-300 dark:border-zinc-600 px-3 py-2">
          {children}
        </td>
      );
    },
  };

  return (
    <div className={`markdown-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`}>
      <ReactMarkdown
        // 插件顺序：remark(语法) -> rehype(HTML 处理)，确保数学与高亮都生效
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
