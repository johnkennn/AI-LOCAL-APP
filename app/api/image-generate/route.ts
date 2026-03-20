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
    const body = (await req.json()) as {
      prompt: string;
      model?: string;
      width?: number;
      height?: number;
      steps?: number;
    };

    const {
      prompt,
      model = 'x/flux2-klein:4b',
      width = 512,
      height = 512,
      steps = 6,
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'prompt 不能为空' }, { status: 400 });
    }

    // 为了更省时：默认较小分辨率 & 较少 steps
    const safeWidth = Math.max(128, Math.min(1024, Math.floor(width)));
    const safeHeight = Math.max(128, Math.min(1024, Math.floor(height)));
    const safeSteps = Math.max(1, Math.min(30, Math.floor(steps)));

    const genReq = {
      model,
      prompt,
      stream: false,
      width: safeWidth,
      height: safeHeight,
      steps: safeSteps,
    } as unknown as Parameters<typeof ollama.generate>[0];

    const result = await ollama.generate(genReq);

    const resultAny = result as {
      response?: unknown;
      image?: unknown;
      images?: unknown;
    };

    // Ollama 图像生成的返回字段并不一定在 `response`，
    // 例如：x/flux2-klein:4b 会在顶层返回 `image` base64，而 `response` 为空字符串。
    let base64 = '';
    const rawResponse = resultAny.response;
    if (typeof rawResponse === 'string') {
      base64 = stripDataUrl(rawResponse);
    }
    if (!base64 && typeof resultAny.image === 'string') {
      base64 = stripDataUrl(resultAny.image);
    }
    if (!base64 && Array.isArray(resultAny.images) && typeof resultAny.images[0] === 'string') {
      base64 = stripDataUrl(resultAny.images[0]);
    }
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

