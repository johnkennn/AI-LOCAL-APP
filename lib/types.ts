export interface Message {
  role: string;
  content: string;
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
  kind: 'txt' | 'md' | 'pdf' | 'img';
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
