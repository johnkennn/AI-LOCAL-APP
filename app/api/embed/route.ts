import { NextResponse } from 'next/server';

const MAX_EMBED_CHARS = 1500;

/**
 * embeddings 输入的“安全截断”：
 * - Ollama embedding 模型通常 context 较短，过长会直接报 exceeds context length
 * - 这里按字符截断（非 token），用于保护后端稳定性
 */
function safeForEmbedding(text: string): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= MAX_EMBED_CHARS) return clean;
  return clean.slice(0, MAX_EMBED_CHARS);
}

/**
 * embedding API：
 * - 前端本地 RAG 用它拿向量（配合 IndexedDB 缓存避免重复计算）
 * - 服务端只做“转发到本机 Ollama + 超长重试”，不参与切片与检索
 */
export async function POST(req: Request) {
  try {
    const { model = 'mxbai-embed-large', prompt } = (await req.json()) as {
      model?: string;
      prompt: string;
    };

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt 不能为空' }, { status: 400 });
    }

    // embedding 输入过长会触发 Ollama 的 context length 错误。
    // 这里做“逐步截断重试”，保证即使是较长切片也能尽量返回向量（代价是语义可能损失一些）。
    const base = safeForEmbedding(prompt);
    const attempts = [base, base.slice(0, 800), base.slice(0, 400), base.slice(0, 200)].filter(
      (v, i, arr) => v && arr.indexOf(v) === i,
    );

    let lastErr: string | null = null;
    for (const p of attempts) {
      const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: p }),
      });

      if (res.ok) {
        const data = (await res.json()) as { embedding: number[] };
        return NextResponse.json({ embedding: data.embedding });
      }

      const text = await res.text().catch(() => '');
      lastErr = `embeddings 请求失败: ${res.status}${text ? ` - ${text}` : ''}`;
      if (!text.includes('exceeds the context length')) break;
    }

    return NextResponse.json({ error: lastErr ?? 'embeddings 请求失败' }, { status: 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

