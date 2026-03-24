import type {
  AudioSegmentInsight,
  TimelineEvent,
  VideoAnalysisResult,
  VideoFrameInsight,
} from '@/lib/video/types';

/** 夹紧到 0~1 的置信度范围。 */
function clamp01(v: number) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** 将逐帧视觉摘要与时间对齐的音频片段融合成粗粒度时间线事件。 */
function buildTimeline(
  frameInsights: VideoFrameInsight[],
  audioInsights: AudioSegmentInsight[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const seen = new Set<string>();

  for (const f of frameInsights) {
    const linkedAudio = audioInsights.filter(
      (a) => a.startSec <= f.tSec && a.endSec >= f.tSec,
    );
    const evidence = [f.visualSummary, ...linkedAudio.map((a) => a.text)].filter(Boolean);
    const hasAudio = linkedAudio.length > 0;
    const event: TimelineEvent = {
      startSec: Math.max(0, f.tSec - 1),
      endSec: f.tSec + 1,
      event: f.visualSummary,
      confidence: clamp01(hasAudio ? 0.78 : 0.62),
      evidence,
    };
    const key = `${event.startSec.toFixed(1)}|${event.endSec.toFixed(1)}|${event.event}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }

  events.sort((a, b) => a.startSec - b.startSec);
  return events;
}

/** 基于音视频中间结果生成可读摘要（当前为规则版，后续可替换 LLM 融合）。 */
export function fuseVideoAudioToNarrative(params: {
  userPrompt: string;
  frameInsights: VideoFrameInsight[];
  audioInsights: AudioSegmentInsight[];
}): VideoAnalysisResult {
  const { userPrompt, frameInsights, audioInsights } = params;
  const timeline = buildTimeline(frameInsights, audioInsights);
  const audioText = audioInsights.map((s) => s.text.trim()).filter(Boolean).join('；');

  const summary =
    timeline.length > 0
      ? `基于画面与音频线索，视频主要内容为：${timeline
          .slice(0, 3)
          .map((t) => t.event)
          .join('；')}。`
      : '未检测到足够的时间线事件，建议提高抽帧密度或补充音频转写结果。';

  const caveats: string[] = [];
  if (frameInsights.length < 5) {
    caveats.push('当前抽帧数量较少，长视频时序细节可能缺失。');
  }
  if (!audioText) {
    caveats.push('当前未提供有效音频转写，涉及歌声/台词判断的准确率会下降。');
  }
  if (/周杰伦|歌名|歌曲/.test(userPrompt) && !audioInsights.some((a) => a.musicHint)) {
    caveats.push('未接入音乐指纹能力，歌手/曲目识别仅凭语音文本推断，置信度有限。');
  }

  return {
    summary,
    timeline,
    audioSummary: audioText || '无有效音频文本。',
    caveats,
  };
}

