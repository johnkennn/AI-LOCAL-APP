import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AudioSegmentInsight, VideoTranscribeResult } from '@/lib/video/types';

const execFileAsync = promisify(execFile);

type WhisperJsonSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type WhisperJson = {
  language?: string;
  text?: string;
  segments?: WhisperJsonSegment[];
};

/** 递归创建目录。 */
async function ensureDir(path: string) {
  await fs.mkdir(path, { recursive: true });
}

/** 将 whisper JSON 段落映射为项目统一音频洞察结构。 */
function mapWhisperSegments(segments: WhisperJsonSegment[]): AudioSegmentInsight[] {
  return segments
    .filter((s) => typeof s.text === 'string')
    .map((s) => ({
      startSec: Number.isFinite(s.start) ? Number(s.start) : 0,
      endSec: Number.isFinite(s.end) ? Number(s.end) : 0,
      text: (s.text ?? '').trim(),
    }))
    .filter((s) => s.text.length > 0);
}

/** 保存上传音频到临时目录，返回本地路径。 */
export async function saveUploadedAudioToTemp(file: File): Promise<string> {
  const jobId = `audio-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const root = join(tmpdir(), 'ai-local-app-video-jobs', jobId);
  await ensureDir(root);
  const ext = extname(file.name) || '.wav';
  const audioPath = join(root, `audio${ext}`);
  await fs.writeFile(audioPath, Buffer.from(await file.arrayBuffer()));
  return audioPath;
}

/**
 * 使用本机 whisper CLI 转写（需系统已安装 `whisper` 命令）。
 * 命令示例：
 * whisper input.wav --model base --output_format json --output_dir /tmp/xxx
 */
export async function transcribeAudioWithWhisperCli(params: {
  audioPath: string;
  model?: string;
  language?: string;
}): Promise<VideoTranscribeResult> {
  const model = params.model ?? 'base';
  const jobId = `transcribe-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outDir = join(tmpdir(), 'ai-local-app-video-jobs', jobId, 'whisper-out');
  await ensureDir(outDir);

  const args = [
    params.audioPath,
    '--model',
    model,
    '--output_format',
    'json',
    '--output_dir',
    outDir,
    '--fp16',
    'False',
  ];
  if (params.language && params.language.trim()) {
    args.push('--language', params.language.trim());
  }

  await execFileAsync('whisper', args, { maxBuffer: 1024 * 1024 * 16 });

  const stem = basename(params.audioPath, extname(params.audioPath));
  const jsonPath = join(outDir, `${stem}.json`);
  const raw = await fs.readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw) as WhisperJson;

  const segments = mapWhisperSegments(parsed.segments ?? []);
  const fullText =
    typeof parsed.text === 'string'
      ? parsed.text.trim()
      : segments.map((s) => s.text).join(' ');

  return {
    jobId,
    audioPath: params.audioPath,
    language: parsed.language,
    segments,
    fullText,
  };
}

