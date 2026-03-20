export interface Message {
  role: string;
  content: string;
  /**
   * 图片生成/多模态结果的附件（不通过 Markdown content 承载，避免 content 膨胀）。
   * 目前仅前端渲染用；持久化到 IndexedDB 的内容体积取决于 base64 大小。
   */
  images?: Array<{ mimeType: string; base64: string }>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  titleGenerated?: boolean;
}

export interface DocItem {
  id: string;
  name: string;
  content: string;
  kind: 'txt' | 'md' | 'pdf' | 'img' | 'video';
  objectUrl?: string;
  blob?: Blob;
  pages?: Array<{ page: number; text: string }>;
  checked: boolean;
  /** 图片视觉理解摘要（VLM 输出），用于自然场景分析/问答的资料注入。 */
  visionSummary?: string;
  /**
   * VLM 处理状态：
   * - none：未分析（允许自动队列触发）
   * - done：分析成功（不会再自动触发）
   * - error：分析失败（停止自动重试，避免面板闪烁；仍可手动点击“分析图片”重试）
   */
  visionStatus?: 'none' | 'done' | 'error';
}
