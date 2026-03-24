import { NextResponse } from 'next/server';

import { fuseVideoAudioToNarrative } from '@/lib/video/fusion';
import type { VideoAnalyzeRequest } from '@/lib/video/types';

/** 判断入参是否为有限数值。 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 入口：接收视觉/音频洞察并输出融合后的时间线与摘要。 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<VideoAnalyzeRequest> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体格式不正确' }, { status: 400 });
    }

    const userPrompt =
      typeof body.userPrompt === 'string' ? body.userPrompt.trim() : '';
    const frameInsights = Array.isArray(body.frameInsights) ? body.frameInsights : [];
    const audioInsights = Array.isArray(body.audioInsights) ? body.audioInsights : [];

    if (!userPrompt) {
      return NextResponse.json({ error: 'userPrompt 不能为空' }, { status: 400 });
    }
    if (frameInsights.length === 0 && audioInsights.length === 0) {
      return NextResponse.json(
        { error: 'frameInsights 与 audioInsights 不能同时为空' },
        { status: 400 },
      );
    }

    const safeFrames = frameInsights
      .filter(
        (f): f is { tSec: number; visualSummary: string } =>
          !!f &&
          isFiniteNumber((f as { tSec?: unknown }).tSec) &&
          typeof (f as { visualSummary?: unknown }).visualSummary === 'string',
      )
      .map((f) => ({ tSec: f.tSec, visualSummary: f.visualSummary.trim() }))
      .filter((f) => f.visualSummary.length > 0);

    const safeAudio = audioInsights
      .filter(
        (a): a is {
          startSec: number;
          endSec: number;
          text: string;
          speaker?: string;
          musicHint?: string;
        } =>
          !!a &&
          isFiniteNumber((a as { startSec?: unknown }).startSec) &&
          isFiniteNumber((a as { endSec?: unknown }).endSec) &&
          typeof (a as { text?: unknown }).text === 'string',
      )
      .map((a) => ({
        startSec: a.startSec,
        endSec: a.endSec,
        text: a.text.trim(),
        speaker: typeof a.speaker === 'string' ? a.speaker : undefined,
        musicHint: typeof a.musicHint === 'string' ? a.musicHint : undefined,
      }))
      .filter((a) => a.text.length > 0);

    const result = fuseVideoAudioToNarrative({
      userPrompt,
      frameInsights: safeFrames,
      audioInsights: safeAudio,
    });

    return NextResponse.json({
      ok: true,
      stage: 'fusion',
      result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

