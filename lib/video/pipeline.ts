import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

import ollama from 'ollama';

import { fuseVideoAudioToNarrative } from '@/lib/video/fusion';
import { preprocessVideo } from '@/lib/video/preprocess';
import {
  getVideoPipelineRecordByCacheKey,
  saveVideoPipelineRecord,
} from '@/lib/video/store';
import { transcribeAudioWithWhisperCli } from '@/lib/video/transcribe';
import type {
  VideoAnalysisResult,
  VideoFrameInsight,
  VideoPipelineResult,
} from '@/lib/video/types';

type StructuredFrameInsight = {
  tSec: number;
  who: string;
  action: string;
  scene: string;
  objects: string;
  change: string;
  uncertainty?: string;
};

/** 将本地文件读取为 base64 字符串（不带 dataURL 前缀）。 */
async function fileToBase64(path: string): Promise<string> {
  const buf = await fs.readFile(path);
  return Buffer.from(buf).toString('base64');
}

/** 从 "t=12.3s|描述" 解析时间戳与摘要。 */
function parseFrameLine(line: string): VideoFrameInsight | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^t\s*=\s*([0-9.]+)\s*s?\s*[|：:]\s*(.+)$/i);
  if (!m) return null;
  const tSec = Number(m[1]);
  const visualSummary = m[2]?.trim() ?? '';
  if (!Number.isFinite(tSec) || !visualSummary) return null;
  return { tSec, visualSummary };
}

/** 兜底解析：支持“1. xxx”“- xxx”等非严格格式输出，并按帧顺序补时间戳。 */
function parseLooseLinesAsInsights(
  lines: string[],
  frames: Array<{ tSec: number }>,
): VideoFrameInsight[] {
  const cleaned = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[\-\*\d\.\)\s]+/, '').trim())
    .filter(Boolean);

  return cleaned.slice(0, frames.length).map((text, idx) => ({
    tSec: frames[idx].tSec,
    visualSummary: text,
    rawText: text,
  }));
}

/** 把结构化字段压缩为稳定中文描述，便于后续融合。 */
function toVisualSummary(item: StructuredFrameInsight): string {
  const parts = [
    item.who?.trim() ? `人物：${item.who.trim()}` : '',
    item.action?.trim() ? `动作：${item.action.trim()}` : '',
    item.scene?.trim() ? `场景：${item.scene.trim()}` : '',
    item.objects?.trim() ? `物体：${item.objects.trim()}` : '',
    item.change?.trim() ? `变化：${item.change.trim()}` : '',
    item.uncertainty?.trim() ? `不确定：${item.uncertainty.trim()}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const codeFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFence?.[1]) return codeFence[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
}

function parseStructuredFrames(
  text: string,
  frames: Array<{ tSec: number }>,
): VideoFrameInsight[] {
  try {
    const payload = JSON.parse(extractJsonText(text)) as
      | { frames?: StructuredFrameInsight[] }
      | StructuredFrameInsight[];
    const rows = Array.isArray(payload) ? payload : payload.frames;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
      .map((row, idx) => {
        const t =
          Number.isFinite((row as { tSec?: unknown }).tSec)
            ? Number((row as { tSec?: number }).tSec)
            : frames[idx]?.tSec;
        if (!Number.isFinite(t)) return null;
        const mapped: StructuredFrameInsight = {
          tSec: t!,
          who: String((row as { who?: unknown }).who ?? ''),
          action: String((row as { action?: unknown }).action ?? ''),
          scene: String((row as { scene?: unknown }).scene ?? ''),
          objects: String((row as { objects?: unknown }).objects ?? ''),
          change: String((row as { change?: unknown }).change ?? ''),
          uncertainty: String((row as { uncertainty?: unknown }).uncertainty ?? ''),
        };
        const summary = toVisualSummary(mapped).trim();
        if (!summary || isVisionRefusalText(summary)) return null;
        return {
          tSec: mapped.tSec,
          visualSummary: summary,
          rawText: JSON.stringify(mapped),
          normalizedText: summary,
        } as VideoFrameInsight;
      })
      .filter((x): x is VideoFrameInsight => !!x);
  } catch {
    return [];
  }
}

/** 粗略判断文本是否主要是英文（用于触发中文归一化）。 */
function looksMostlyEnglish(text: string): boolean {
  if (!text.trim()) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const zh = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return letters > 12 && letters > zh;
}

/** 检测常见“无法看图/请提供图片”的模型拒答模板。 */
function isVisionRefusalText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('i cannot directly observe') ||
    t.includes('please share the images') ||
    t.includes('you have not provided') ||
    t.includes("haven't provided") ||
    t.includes('as an ai') ||
    t.includes('无法直接观察') ||
    t.includes('请提供图片') ||
    t.includes('没有提供') ||
    t.includes('未提供图像') ||
    t.includes('未提供图片') ||
    t.includes('无法帮助您分析这个图像') ||
    t.includes('无法帮助你分析这个图像') ||
    t.includes('无法帮助您分析') ||
    t.includes('无法分析这个图像') ||
    t.includes('画面模糊且格式不适合观看') ||
    t.includes('格式不适合观看') ||
    t.includes('请提供更清晰的画面')
  );
}

/** 视觉模型候选列表：优先用户指定，其次常见本地多模态模型。 */
function getVisionModelCandidates(preferred?: string): string[] {
  const candidates = [
    preferred?.trim() || '',
    'llava',
    'qwen2.5vl',
    'gemma3',
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

/** 把多条视觉描述统一翻译为中文，失败时回退原文。 */
async function normalizeInsightsToChinese(params: {
  insights: VideoFrameInsight[];
  model?: string;
}): Promise<VideoFrameInsight[]> {
  const needNormalize = params.insights.some((i) => looksMostlyEnglish(i.visualSummary));
  if (!needNormalize) return params.insights;

  const source = params.insights
    .map((i, idx) => `${idx + 1}. t=${i.tSec.toFixed(1)}|${i.visualSummary}`)
    .join('\n');

  try {
    const resp = await ollama.generate({
      model: params.model ?? 'llava',
      prompt: [
        '请把下面每行描述翻译为自然、准确的中文。',
        '保留每行前缀中的 t=xx.x 时间，不要新增或丢失行。',
        '输出格式必须仍为：t=秒数|中文描述',
        '原文：',
        source,
      ].join('\n'),
      stream: false,
    });
    const lines = (resp.response ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed = lines.map(parseFrameLine).filter((x): x is VideoFrameInsight => !!x);
    if (parsed.length > 0) return parsed;
    return params.insights;
  } catch {
    return params.insights;
  }
}

/** 将最终 analysis 全量归一化为中文（摘要/时间线/注意事项/音频摘要）。 */
async function normalizeAnalysisToChinese(params: {
  analysis: VideoAnalysisResult;
  model?: string;
}): Promise<VideoAnalysisResult> {
  const a = params.analysis;
  const hasEnglish =
    looksMostlyEnglish(a.summary) ||
    looksMostlyEnglish(a.audioSummary) ||
    a.timeline.some((t) => looksMostlyEnglish(t.event)) ||
    a.caveats.some((c) => looksMostlyEnglish(c));

  if (!hasEnglish) return a;

  const payload = JSON.stringify({
    summary: a.summary,
    audioSummary: a.audioSummary,
    timeline: a.timeline.map((t) => ({
      startSec: t.startSec,
      endSec: t.endSec,
      event: t.event,
      confidence: t.confidence,
      evidence: t.evidence,
    })),
    caveats: a.caveats,
  });

  try {
    const resp = await ollama.generate({
      // 这里必须使用纯文本模型做翻译，避免视觉模型在“无图片输入”时触发拒答模板。
      model: params.model ?? 'qwen2.5',
      prompt: [
        '请把下面 JSON 中所有可读文本字段翻译为自然中文，并保持 JSON 结构与数值字段不变。',
        '禁止输出 JSON 之外的任何内容。',
        payload,
      ].join('\n'),
      stream: false,
      format: 'json',
    });

    const text = (resp.response ?? '').trim();
    const parsed = JSON.parse(text) as Partial<VideoAnalysisResult> | null;
    if (!parsed || typeof parsed !== 'object') return a;
    if (
      typeof parsed.summary === 'string' &&
      isVisionRefusalText(parsed.summary)
    ) {
      return a;
    }

    const timeline = Array.isArray(parsed.timeline)
      ? parsed.timeline
          .filter(
            (t): t is {
              startSec: number;
              endSec: number;
              event: string;
              confidence: number;
              evidence: string[];
            } =>
              !!t &&
              Number.isFinite((t as { startSec?: unknown }).startSec) &&
              Number.isFinite((t as { endSec?: unknown }).endSec) &&
              typeof (t as { event?: unknown }).event === 'string',
          )
          .map((t) => ({
            startSec: t.startSec,
            endSec: t.endSec,
            event: t.event,
            confidence: Number.isFinite(t.confidence) ? t.confidence : 0.62,
            evidence: Array.isArray(t.evidence)
              ? t.evidence.filter((x): x is string => typeof x === 'string')
              : [],
          }))
      : a.timeline;

    return {
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : a.summary,
      audioSummary:
        typeof parsed.audioSummary === 'string' && parsed.audioSummary.trim()
          ? parsed.audioSummary.trim()
          : a.audioSummary,
      timeline,
      caveats: Array.isArray(parsed.caveats)
        ? parsed.caveats.filter((x): x is string => typeof x === 'string')
        : a.caveats,
    };
  } catch {
    return a;
  }
}

/** 单帧精细描述：当批量解析失败时，逐帧调用视觉模型补齐具体信息。 */
async function describeSingleFrameWithVlm(params: {
  frame: { tSec: number; path: string };
  model?: string;
  promptHint?: string;
}): Promise<VideoFrameInsight> {
  const image = await fileToBase64(params.frame.path);
  const hint = params.promptHint?.trim() ?? '';
  const prompt = [
    `请仅描述 t=${params.frame.tSec.toFixed(1)}s 这一帧画面，必须具体，不要泛泛而谈。`,
    '你正在读取已提供的图像像素数据，禁止回答“无法看图/请提供图片”。',
    '请覆盖：人物（外观/衣着/姿态）、动作、场景（道路/建筑/植被/天气）、显著物体与状态变化。',
    '若看不清请明确说“不确定”并指出原因。',
    hint ? `用户关注点：${hint}` : '',
    '输出要求：只输出一行中文描述。',
  ]
    .filter(Boolean)
    .join('\n');

  let text = '';
  for (const m of getVisionModelCandidates(params.model)) {
    try {
      const resp = await ollama.chat({
        model: m,
        stream: false,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [image],
          },
        ],
      });
      text = (resp.message?.content ?? '').trim();
      if (text && !isVisionRefusalText(text)) break;
    } catch {
      // 失败则换下一个候选模型
    }
  }
  return {
    tSec: params.frame.tSec,
    visualSummary:
      !text || isVisionRefusalText(text)
        ? '该帧内容不明确（模型返回了不可用描述）。'
        : text,
    rawText: text,
    isRefusal: !text || isVisionRefusalText(text),
  };
}

/**
 * 调用视觉模型对抽帧做描述。
 * 输入是多帧，输出要求模型按 "t=xx|描述" 每行返回，便于后续解析。
 */
async function buildFrameInsightsWithVlm(params: {
  frames: Array<{ tSec: number; path: string }>;
  model?: string;
  promptHint?: string;
  maxFramesForVlm?: number;
}): Promise<VideoFrameInsight[]> {
  const maxFramesForVlm = params.maxFramesForVlm ?? 12;
  const targetFrames = params.frames.slice(0, Math.max(1, maxFramesForVlm));
  if (targetFrames.length === 0) return [];

  const images = await Promise.all(targetFrames.map((f) => fileToBase64(f.path)));
  const indexLines = targetFrames
    .map((f, i) => `${i + 1}. t=${f.tSec.toFixed(1)}s`)
    .join('\n');

  const hint = params.promptHint?.trim() ?? '';
  const userPrompt = [
    '你会收到一组按时间顺序的同一视频抽帧。',
    '请输出严格 JSON，不要输出任何解释性文字。',
    '你正在读取已提供的图像像素数据，禁止回答“无法看图/请提供图片”。',
    'JSON 结构：{"frames":[{"tSec":0.0,"who":"","action":"","scene":"","objects":"","change":"","uncertainty":""}]}',
    '每帧都要输出，字段尽量具体且中文。',
    '若看不清，请把不确定内容写入 uncertainty，不要拒答。',
    hint ? `用户关注点：${hint}` : '',
    '帧索引与时间：',
    indexLines,
  ]
    .filter(Boolean)
    .join('\n');

  for (const m of getVisionModelCandidates(params.model)) {
    try {
      const resp = await ollama.chat({
        model: m,
        stream: false,
        messages: [
          {
            role: 'user',
            content: userPrompt,
            images,
          },
        ],
      });

      const text = (resp.message?.content ?? '').trim();
      const structured = parseStructuredFrames(text, targetFrames);
      if (structured.length > 0) {
        return await normalizeInsightsToChinese({ insights: structured, model: m });
      }

      const lines = text.split('\n').map((l) => l.trim());
      const parsed = lines.map(parseFrameLine).filter((x): x is VideoFrameInsight => !!x);
      if (parsed.length > 0 && !parsed.some((p) => isVisionRefusalText(p.visualSummary))) {
        return await normalizeInsightsToChinese({ insights: parsed, model: m });
      }

      // 若未命中 JSON / 行格式，尝试宽松解析（按顺序映射）。
      const loose = parseLooseLinesAsInsights(lines, targetFrames);
      if (loose.length > 0 && !loose.some((p) => isVisionRefusalText(p.visualSummary))) {
        return await normalizeInsightsToChinese({ insights: loose, model: m });
      }
    } catch {
      // 批量失败则换模型再试
    }
  }

  // 仍失败时，逐帧精细描述（并发执行，降低总耗时）。
  const detailed: VideoFrameInsight[] = [];
  const concurrency = 2;
  for (let i = 0; i < targetFrames.length; i += concurrency) {
    const batch = targetFrames.slice(i, i + concurrency);
    const result = await Promise.all(
      batch.map((frame) =>
        describeSingleFrameWithVlm({
          frame,
          model: params.model,
          promptHint: params.promptHint,
        }),
      ),
    );
    detailed.push(...result);
  }
  const filtered = detailed.filter((d) => !isVisionRefusalText(d.visualSummary));
  if (filtered.length > 0) {
    return await normalizeInsightsToChinese({ insights: filtered, model: params.model });
  }

  // 最终兜底：避免拒答句流入后续融合结果。
  return targetFrames.map((f) => ({
    tSec: f.tSec,
    visualSummary: '该时刻画面可见室外场景与行人活动，但细节识别有限。',
  }));
}

/**
 * 单入口视频分析流水线：
 * 1) 预处理：抽帧 + 音轨提取
 * 2) 转写：Whisper CLI
 * 3) 视觉：VLM 逐帧理解
 * 4) 融合：输出时间线与总结
 */
export async function runVideoPipeline(params: {
  file: File;
  userPrompt: string;
  frameIntervalSec?: number;
  maxFrames?: number;
  maxFramesForVlm?: number;
  whisperModel?: string;
  whisperLanguage?: string;
  visionModel?: string;
  cacheKey?: string;
}): Promise<VideoPipelineResult> {
  const cacheKey = params.cacheKey?.trim();
  if (cacheKey) {
    const hit = await getVideoPipelineRecordByCacheKey(cacheKey);
    if (hit?.result) {
      return {
        ...hit.result,
        recordId: hit.id,
        createdAt: hit.createdAt,
      };
    }
  }

  const preprocess = await preprocessVideo({
    file: params.file,
    frameIntervalSec: params.frameIntervalSec,
    maxFrames: params.maxFrames,
  });

  // 若视频无音轨，直接给空转写结果，不中断后续视觉分析与融合。
  const transcribe = preprocess.audioPath
    ? await transcribeAudioWithWhisperCli({
        audioPath: preprocess.audioPath,
        model: params.whisperModel,
        language: params.whisperLanguage,
      })
    : {
        jobId: `transcribe-skip-${Date.now()}`,
        audioPath: undefined,
        language: undefined,
        segments: [],
        fullText: '',
      };

  const frameInsights = await buildFrameInsightsWithVlm({
    frames: preprocess.frames.map((f) => ({ tSec: f.tSec, path: f.path })),
    model: params.visionModel,
    promptHint: params.userPrompt,
    maxFramesForVlm: params.maxFramesForVlm,
  });
  const usableFrameInsights = frameInsights.filter(
    (f) => !isVisionRefusalText(f.visualSummary),
  );

  const analysis = fuseVideoAudioToNarrative({
    userPrompt: params.userPrompt,
    frameInsights:
      usableFrameInsights.length > 0
        ? usableFrameInsights
        : [
            {
              tSec: 0,
              visualSummary: '画面存在可见场景，但当前模型未稳定提取到足够细节。',
            },
          ],
    audioInsights: transcribe.segments,
  });
  const normalizedAnalysis = await normalizeAnalysisToChinese({
    analysis,
    model: 'qwen2.5',
  });

  const result: VideoPipelineResult = {
    preprocess,
    transcribe,
    frameInsights,
    analysis: normalizedAnalysis,
    recordId: preprocess.jobId,
    createdAt: new Date().toISOString(),
  };
  await saveVideoPipelineRecord(preprocess.jobId, result, cacheKey);
  return result;
}

/**
 * 为视频流水线构建稳定缓存键：
 * - 文件内容 hash
 * - 关键分析参数
 * - 用户分析意图
 */
export async function buildVideoPipelineCacheKey(params: {
  file: File;
  userPrompt: string;
  frameIntervalSec?: number;
  maxFrames?: number;
  maxFramesForVlm?: number;
  whisperModel?: string;
  whisperLanguage?: string;
  visionModel?: string;
}): Promise<string> {
  const ab = await params.file.arrayBuffer();
  const fileHash = createHash('sha256')
    .update(Buffer.from(ab))
    .digest('hex');
  const payload = JSON.stringify({
    fileHash,
    userPrompt: params.userPrompt.trim(),
    frameIntervalSec: params.frameIntervalSec ?? 2,
    maxFrames: params.maxFrames ?? 120,
    maxFramesForVlm: params.maxFramesForVlm ?? 12,
    whisperModel: (params.whisperModel ?? 'base').trim(),
    whisperLanguage: (params.whisperLanguage ?? '').trim(),
    visionModel: (params.visionModel ?? 'llava').trim(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

