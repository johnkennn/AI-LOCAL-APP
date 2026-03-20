import ollama from 'ollama';
import { NextResponse } from 'next/server';

function stripDataUrl(dataUrlOrBase64: string) {
  const s = dataUrlOrBase64.trim();
  if (s.startsWith('data:')) {
    const parts = s.split(',');
    return parts[1] ?? '';
  }
  return s;
}

function guessMimeFromBase64(base64: string) {
  // 常见图片 base64 文件头特征
  if (!base64) return 'image/png';
  if (base64.startsWith('iVBOR')) return 'image/png'; // PNG
  if (base64.startsWith('/9j/')) return 'image/jpeg'; // JPEG
  if (base64.startsWith('R0lGOD')) return 'image/gif'; // GIF
  return 'image/png';
}

export async function POST(req: Request) {
  try {
    const { prompt, model = 'x/z-image-turbo:latest' } = await req.json();
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'prompt 不能为空' }, { status: 400 });
    }

    const result = await ollama.generate({
      model,
      prompt,
      stream: false,
    });

    const raw = (result as { response?: unknown })?.response;
    const base64 = typeof raw === 'string' ? stripDataUrl(raw) : '';
    if (!base64) {
      return NextResponse.json({ error: '生成结果为空' }, { status: 500 });
    }

    const mimeType = guessMimeFromBase64(base64);

    return NextResponse.json({ imageBase64: base64, mimeType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

