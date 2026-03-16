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

export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  const components: Components = {
    pre({ children }) {
      return (
        <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-200 dark:bg-zinc-800 p-4 text-sm">
          {children}
        </pre>
      );
    },
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
    p({ children }) {
      return <p className="my-1.5 leading-relaxed">{children}</p>;
    },
    ul({ children }) {
      return <ul className="my-2 ml-4 list-disc">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="my-2 ml-4 list-decimal">{children}</ol>;
    },
    li({ children }) {
      return <li className="my-0.5">{children}</li>;
    },
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
    blockquote({ children }) {
      return (
        <blockquote className="my-2 border-l-4 border-zinc-400 pl-4 italic text-zinc-600 dark:text-zinc-400">
          {children}
        </blockquote>
      );
    },
    h1({ children }) {
      return <h1 className="mt-4 mb-2 text-lg font-bold">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="mt-3 mb-1.5 text-base font-bold">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="mt-2 mb-1 text-sm font-bold">{children}</h3>;
    },
    table({ children }) {
      return (
        <div className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse border border-zinc-300 dark:border-zinc-600">
            {children}
          </table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-700 px-3 py-2 text-left font-semibold">
          {children}
        </th>
      );
    },
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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
