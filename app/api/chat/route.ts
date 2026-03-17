// app/api/chat/route.ts
import ollama from 'ollama';
import { NextResponse } from 'next/server';

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
