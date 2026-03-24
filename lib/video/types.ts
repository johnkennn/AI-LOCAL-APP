export type VideoFrameInsight = {
  tSec: number;
  visualSummary: string;
  rawText?: string;
  normalizedText?: string;
  isRefusal?: boolean;
};

export type AudioSegmentInsight = {
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
  musicHint?: string;
};

export type TimelineEvent = {
  startSec: number;
  endSec: number;
  event: string;
  confidence: number;
  evidence: string[];
};

export type VideoAnalysisResult = {
  summary: string;
  timeline: TimelineEvent[];
  audioSummary: string;
  caveats: string[];
};

export type VideoPreprocessFrame = {
  index: number;
  tSec: number;
  path: string;
};

export type VideoPreprocessResult = {
  jobId: string;
  videoPath: string;
  audioPath?: string;
  hasAudio: boolean;
  frames: VideoPreprocessFrame[];
  frameIntervalSec: number;
  maxFrames: number;
  durationSec?: number;
};

export type VideoAnalyzeRequest = {
  videoName?: string;
  userPrompt: string;
  frameInsights: VideoFrameInsight[];
  audioInsights: AudioSegmentInsight[];
};

export type VideoTranscribeResult = {
  jobId: string;
  audioPath?: string;
  language?: string;
  segments: AudioSegmentInsight[];
  fullText: string;
};

export type VideoPipelineResult = {
  preprocess: VideoPreprocessResult;
  transcribe: VideoTranscribeResult;
  frameInsights: VideoFrameInsight[];
  analysis: VideoAnalysisResult;
  recordId?: string;
  createdAt?: string;
};

