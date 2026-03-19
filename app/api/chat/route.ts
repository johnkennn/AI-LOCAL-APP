// app/api/chat/route.ts
import ollama from 'ollama';
import { NextResponse } from 'next/server';

/**
 * Chat API：将前端 messages 转发给本机 Ollama，并以“纯文本流”形式返回。
 *
 * 设计要点：
 * - stream: true：便于前端流式拼接渲染，提升交互体验
 * - Content-Type: text/plain：前端直接把 chunk append 到 assistantContent
 * - options 可透传（如 num_ctx），用于控制上下文窗口大小
 */
export async function POST(req: Request) {
  try {
    const { messages, model = 'deepseek-r1', options } = await req.json();
    if (!messages?.length) {
      return NextResponse.json({ error: 'messages 不能为空' }, { status: 400 });
    }

    const response = await ollama.chat({
      model,
      messages,
      ...(options ? { options } : {}),
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const part of response) {
            const content = part.message?.content ?? '';
            if (content) controller.enqueue(content);
          }
        } catch (err) {
          // 流式过程中出错：这里尽量返回可读错误字符串，前端会把它作为 assistant 内容展示
          controller.enqueue(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Ollama 请求失败' })
          );
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
