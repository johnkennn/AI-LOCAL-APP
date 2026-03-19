// app/api/title/route.ts
import ollama from 'ollama';
import { NextResponse } from 'next/server';

/**
 * Title API：根据对话前两句生成短标题（用于侧边栏展示）。
 *
 * 策略：
 * - 只取第一条 user 与第一条 assistant 的少量片段作为 preview，避免传入过长上下文
 * - 系统提示词强约束“只输出标题、不解释”，并对输出做清洗与截断兜底
 */
export async function POST(req: Request) {
  try {
    const { messages, model = 'deepseek-r1' } = await req.json();
    if (!messages?.length) {
      return NextResponse.json({ error: 'messages 不能为空' }, { status: 400 });
    }

    const firstUser = messages.find((m: { role: string }) => m.role === 'user');
    const firstAssistant = messages.find(
      (m: { role: string }) => m.role === 'assistant'
    );
    const preview =
      [firstUser?.content?.slice(0, 100), firstAssistant?.content?.slice(0, 100)]
        .filter(Boolean)
        .join(' | ') || '新对话';

    const response = await ollama.chat({
      model,
      messages: [
        {
          role: 'system',
          content:
            '你只输出一个5字以内的中文标题，概括下面对话的主题。不要引号、不要解释，只输出标题。',
        },
        {
          role: 'user',
          content: preview,
        },
      ],
      stream: false,
    });

    const title = (response.message?.content ?? '新对话')
      .trim()
      .replace(/["'""]/g, '')
      .slice(0, 10) || '新对话';

    return NextResponse.json({ title });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
