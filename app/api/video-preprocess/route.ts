import { NextResponse } from 'next/server';

import { preprocessVideo } from '@/lib/video/preprocess';

export const runtime = 'nodejs';

/** 读取可选数值字段；非法值返回 undefined。 */
function readOptionalNum(v: FormDataEntryValue | null): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 入口：接收视频文件并执行本地预处理（抽帧+分离音轨）。 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const fileEntry = form.get('video');
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: '缺少 video 文件字段' }, { status: 400 });
    }

    const frameIntervalSec = readOptionalNum(form.get('frameIntervalSec'));
    const maxFrames = readOptionalNum(form.get('maxFrames'));

    const result = await preprocessVideo({
      file: fileEntry,
      frameIntervalSec,
      maxFrames,
    });

    return NextResponse.json({
      ok: true,
      stage: 'preprocess',
      result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json(
      {
        error: `视频预处理失败: ${msg}`,
        hint: '请确认已安装 ffmpeg/ffprobe，且视频文件可解码。',
      },
      { status: 500 },
    );
  }
}

