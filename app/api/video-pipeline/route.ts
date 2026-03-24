import { NextResponse } from 'next/server';

import { buildVideoPipelineCacheKey, runVideoPipeline } from '@/lib/video/pipeline';
import { getVideoPipelineRecord } from '@/lib/video/store';

export const runtime = 'nodejs';

/** 读取可选数值字段。 */
function readOptionalNum(v: FormDataEntryValue | null): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 读取可选字符串字段。 */
function readOptionalStr(v: FormDataEntryValue | null): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * 单入口：上传视频后直接返回综合分析结果。
 * form-data:
 * - video: File (required)
 * - userPrompt: string (required)
 * - frameIntervalSec/maxFrames/maxFramesForVlm/whisperModel/whisperLanguage/visionModel: optional
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const video = form.get('video');
    if (!(video instanceof File)) {
      return NextResponse.json({ error: '缺少 video 文件字段' }, { status: 400 });
    }

    const userPrompt = readOptionalStr(form.get('userPrompt')) ?? '';
    if (!userPrompt) {
      return NextResponse.json({ error: 'userPrompt 不能为空' }, { status: 400 });
    }

    const frameIntervalSec = readOptionalNum(form.get('frameIntervalSec'));
    const maxFrames = readOptionalNum(form.get('maxFrames'));
    const maxFramesForVlm = readOptionalNum(form.get('maxFramesForVlm'));
    const whisperModel = readOptionalStr(form.get('whisperModel'));
    const whisperLanguage = readOptionalStr(form.get('whisperLanguage'));
    const visionModel = readOptionalStr(form.get('visionModel'));

    const cacheKey = await buildVideoPipelineCacheKey({
      file: video,
      userPrompt,
      frameIntervalSec,
      maxFrames,
      maxFramesForVlm,
      whisperModel,
      whisperLanguage,
      visionModel,
    });

    const result = await runVideoPipeline({
      file: video,
      userPrompt,
      frameIntervalSec,
      maxFrames,
      maxFramesForVlm,
      whisperModel,
      whisperLanguage,
      visionModel,
      cacheKey,
    });

    return NextResponse.json({
      ok: true,
      stage: 'pipeline',
      result,
      cacheKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json(
      {
        error: `视频流水线执行失败: ${msg}`,
        hint: '请确认本机已安装 ffmpeg/ffprobe/whisper，并已安装视觉模型（默认 llava）。',
      },
      { status: 500 },
    );
  }
}

/**
 * 查询持久化结果：
 * GET /api/video-pipeline?jobId=xxx
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = readOptionalStr(searchParams.get('jobId'));
    if (!jobId) {
      return NextResponse.json({ error: '缺少 jobId 参数' }, { status: 400 });
    }
    const record = await getVideoPipelineRecord(jobId);
    if (!record) {
      return NextResponse.json({ error: '未找到对应持久化记录' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, stage: 'pipeline-record', record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: `读取持久化结果失败: ${msg}` }, { status: 500 });
  }
}

