import { NextResponse } from 'next/server';

import {
  saveUploadedAudioToTemp,
  transcribeAudioWithWhisperCli,
} from '@/lib/video/transcribe';

export const runtime = 'nodejs';

/**
 * 入口：音频转写。
 * 支持两种输入方式：
 * 1) form-data 的 `audio` 文件
 * 2) JSON 的 `audioPath`（通常来自 /api/video-preprocess 结果）
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    let audioPath = '';
    let language: string | undefined;
    let model: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const audioEntry = form.get('audio');
      if (!(audioEntry instanceof File)) {
        return NextResponse.json({ error: '缺少 audio 文件字段' }, { status: 400 });
      }
      language = typeof form.get('language') === 'string' ? String(form.get('language')) : undefined;
      model = typeof form.get('model') === 'string' ? String(form.get('model')) : undefined;
      audioPath = await saveUploadedAudioToTemp(audioEntry);
    } else {
      const body = (await req.json()) as {
        audioPath?: string;
        language?: string;
        model?: string;
      };
      audioPath = body.audioPath?.trim() ?? '';
      language = body.language;
      model = body.model;
    }

    if (!audioPath) {
      return NextResponse.json({ error: 'audioPath 不能为空' }, { status: 400 });
    }

    const result = await transcribeAudioWithWhisperCli({
      audioPath,
      language,
      model,
    });

    return NextResponse.json({
      ok: true,
      stage: 'transcribe',
      result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json(
      {
        error: `音频转写失败: ${msg}`,
        hint: '请确认本机已安装 whisper CLI，且可在终端直接执行 `whisper --help`。',
      },
      { status: 500 },
    );
  }
}

