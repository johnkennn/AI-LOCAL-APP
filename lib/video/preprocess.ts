import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { VideoPreprocessFrame, VideoPreprocessResult } from '@/lib/video/types';

const execFileAsync = promisify(execFile);

/** 将数值限制在 [min, max] 区间。 */
function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** 递归创建目录（已存在则忽略）。 */
async function ensureDir(path: string) {
  await fs.mkdir(path, { recursive: true });
}

/** 执行 ffmpeg 命令，统一错误/缓冲参数。 */
async function runFfmpeg(args: string[]) {
  await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 8 });
}

/** 尝试用 ffprobe 获取视频时长（秒），失败返回 undefined。 */
async function tryProbeDurationSec(videoPath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { maxBuffer: 1024 * 1024 * 2 },
    );
    const d = Number(stdout.trim());
    return Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

/** 探测视频是否包含至少一条音频流。 */
async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        videoPath,
      ],
      { maxBuffer: 1024 * 1024 * 2 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** 将抽帧文件列表映射为带时间戳的帧时间线。 */
function mapFrameFilesToTimeline(frameFiles: string[], intervalSec: number): VideoPreprocessFrame[] {
  return frameFiles.map((path, idx) => ({
    index: idx + 1,
    tSec: idx * intervalSec,
    path,
  }));
}

/**
 * 本地视频预处理：
 * 1) 落盘上传视频
 * 2) ffmpeg 按固定间隔抽帧
 * 3) 若存在音轨，则提取 16k/mono 音频（无音轨时不中断流程）
 */
export async function preprocessVideo(params: {
  file: File;
  frameIntervalSec?: number;
  maxFrames?: number;
}): Promise<VideoPreprocessResult> {
  const frameIntervalSec = clampNum(params.frameIntervalSec ?? 2, 0.2, 30);
  const maxFrames = clampNum(params.maxFrames ?? 120, 1, 1200);

  const jobId = `video-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const root = join(tmpdir(), 'ai-local-app-video-jobs', jobId);
  const framesDir = join(root, 'frames');
  await ensureDir(framesDir);

  const extFromName = params.file.name.includes('.')
    ? params.file.name.slice(params.file.name.lastIndexOf('.'))
    : '.mp4';
  const videoPath = join(root, `input${extFromName}`);
  const audioPath = join(root, 'audio.wav');

  const fileBuffer = Buffer.from(await params.file.arrayBuffer());
  await fs.writeFile(videoPath, fileBuffer);

  const durationSec = await tryProbeDurationSec(videoPath);

  // 1) 抽帧（按时间间隔采样），并统一缩放到不超过 960 宽。
  const fpsExpr = `fps=1/${frameIntervalSec}`;
  const framePattern = join(framesDir, 'frame_%06d.jpg');
  await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    videoPath,
    '-vf',
    `${fpsExpr},scale='min(960,iw)':-2`,
    '-frames:v',
    String(maxFrames),
    '-q:v',
    '3',
    '-y',
    framePattern,
  ]);

  // 2) 提取音轨为 16kHz / mono wav（供后续 ASR）。
  // 若视频无音轨，跳过此步骤并继续流程（避免 "Output file does not contain any stream"）。
  const hasAudio = await hasAudioStream(videoPath);
  if (hasAudio) {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-y',
      audioPath,
    ]);
  }

  const allFrameNames = (await fs.readdir(framesDir))
    .filter((n) => /\.jpe?g$/i.test(n))
    .sort();
  const frameFiles = allFrameNames.map((n) => join(framesDir, n));
  const frames = mapFrameFilesToTimeline(frameFiles, frameIntervalSec);

  return {
    jobId,
    videoPath,
    audioPath: hasAudio ? audioPath : undefined,
    hasAudio,
    frames,
    frameIntervalSec,
    maxFrames,
    durationSec,
  };
}

