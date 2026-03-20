'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { ChatWindow } from '@/components/ChatWindow';
import { SettingsDialog } from '@/components/SettingsDialog';
import type { Conversation, Message, DocItem } from '@/lib/types';
import {
  getAllConversations,
  removeConversation as removeConversationFromDb,
  replaceAllConversations,
  upsertConversation,
} from '@/lib/storage/conversations';
import {
  getAllDocs,
  removeDoc as removeDocFromDb,
  toDocItem,
  upsertDoc,
} from '@/lib/storage/docs';
import { retrieveRagHits } from '@/lib/rag/client';

const LEGACY_STORAGE_KEY = 'ai-local-app-chat';
const SETTINGS_KEY = 'ai-local-app:settings:v1';

/** 勾选图片提问时使用的视觉模型（需本机 ollama 已安装）。 */
const VISION_MODEL = 'llava';

/** 图片生成模型（Ollama 实验性图像生成，需本机已拉取）。 */
// 按“更省显存 -> 更高画质”排序，优先避免 OOM。
const IMAGE_GEN_MODELS = [
  'x/flux2-klein:4b',
  'x/z-image-turbo:latest',
  'x/flux2-klein:latest',
] as const;

type SettingsState = {
  currentId: string | null;
  model: string;
  systemPrompt: string;
  numCtx: number;
  ragEnabled: boolean;
  ragTopK: number;
  ragChunkSize: number;
  ragOverlap: number;
  embeddingModel: string;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
};

const DEFAULT_SETTINGS: SettingsState = {
  currentId: null,
  model: 'deepseek-r1',
  systemPrompt: '',
  numCtx: 8192,
  ragEnabled: false,
  ragTopK: 4,
  ragChunkSize: 900,
  ragOverlap: 150,
  embeddingModel: 'mxbai-embed-large',
  leftSidebarOpen: true,
  rightSidebarOpen: true,
};

const MODELS = [
  { id: 'deepseek-r1', name: 'DeepSeek R1' },
  { id: 'gemma2', name: 'Gemma 2' },
  { id: 'qwen2.5', name: 'Qwen 2.5' },
  { id: 'mistral', name: 'Mistral' },
  { id: 'llama3.2', name: 'Llama 3.2' },
  { id: 'llama3.1', name: 'Llama 3.1' },
];

/**
 * 生成稳定的客户端 id（会话/文档等）。
 * 优先使用 crypto.randomUUID；在不支持的环境降级为时间戳+随机串。
 */
function generateId() {
  return (
    crypto.randomUUID?.() ??
    `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * 从 localStorage 读取“轻量设置层”（不含会话/文档大数据）。
 * 失败则回退 DEFAULT_SETTINGS，保证应用可启动。
 */
function loadSettingsFromLocalStorage(): SettingsState {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    const data = JSON.parse(stored) as Partial<SettingsState> | null;
    return {
      ...DEFAULT_SETTINGS,
      ...(data ?? {}),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * 从旧版 localStorage bundle 读取 legacy 数据，用于一次性迁移到 IndexedDB：
 * - 早期版本可能是 { chat: Message[] }
 * - 新一点可能是 { conversations: Conversation[] }
 */
function loadLegacyBundleFromLocalStorage():
  | { conversations: Conversation[]; settings: Partial<SettingsState> }
  | null {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return null;
    const data = JSON.parse(stored);
    // 早期：{ chat: Message[], ...settings }
    if (Array.isArray(data.chat) && data.chat.length > 0 && !data.conversations) {
      const conv: Conversation = {
        id: generateId(),
        title: '历史对话',
        messages: data.chat,
      };
      return {
        conversations: [conv],
        settings: {
          currentId: conv.id,
          model: data.model,
          systemPrompt: data.systemPrompt,
          numCtx: data.numCtx,
          ragEnabled: data.ragEnabled,
          ragTopK: data.ragTopK,
          ragChunkSize: data.ragChunkSize,
          ragOverlap: data.ragOverlap,
          embeddingModel: data.embeddingModel,
        },
      };
    }
    const conversations = Array.isArray(data.conversations) ? data.conversations : [];
    if (conversations.length === 0) return null;
    return {
      conversations,
      settings: {
        currentId: data.currentId ?? conversations[0]?.id ?? null,
        model: data.model,
        systemPrompt: data.systemPrompt,
        numCtx: data.numCtx,
        ragEnabled: data.ragEnabled,
        ragTopK: data.ragTopK,
        ragChunkSize: data.ragChunkSize,
        ragOverlap: data.ragOverlap,
        embeddingModel: data.embeddingModel,
      },
    };
  } catch {
    return null;
  }
}

// OCR 能力已移除：图片仅通过视觉模型（VLM）分析处理。

/**
 * Home：应用主页面。
 * - 设置：localStorage（轻量、读取快）
 * - 会话/文档/embedding 缓存：IndexedDB（容量大、异步、适合长期增长）
 */
export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('deepseek-r1');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [numCtx, setNumCtx] = useState(8192);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [ragTopK, setRagTopK] = useState(4);
  const [ragChunkSize, setRagChunkSize] = useState(900);
  const [ragOverlap, setRagOverlap] = useState(150);
  const [embeddingModel, setEmbeddingModel] = useState('mxbai-embed-large');
  const [ragError, setRagError] = useState<string | null>(null);
  const [ragHits, setRagHits] = useState<
    Array<{
      docId: string;
      docName: string;
      chunk: string;
      score: number;
      pageStart?: number;
      pageEnd?: number;
      heading?: string;
    }>
  >([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const docsRef = useRef<DocItem[]>([]);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  const selectedDocs = docs.filter((d) => d.checked);
  const selectedDocsContent = selectedDocs
    .filter(
      (d) =>
        d.kind === 'txt' ||
        d.kind === 'md' ||
        d.kind === 'pdf' ||
        (d.kind === 'img' && (d.visionSummary ?? '').trim().length > 0),
    )
    .map((d) => {
      if (d.kind !== 'img') return d.content;
      const v = (d.visionSummary ?? '').trim();
      return v ? `【图片视觉分析｜${d.name}】\n${v}` : '';
    })
    .join('\n\n');
  const selectedDocsCharCount = selectedDocsContent.length;
  const isContextTooLong = selectedDocsCharCount > 5000;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) 先加载设置（localStorage）
      const settings = loadSettingsFromLocalStorage();
      if (cancelled) return;
      setCurrentId(settings.currentId);
      setModel(settings.model);
      setSystemPrompt(settings.systemPrompt);
      setNumCtx(settings.numCtx);
      setRagEnabled(settings.ragEnabled);
      setRagTopK(settings.ragTopK);
      setRagChunkSize(settings.ragChunkSize);
      setRagOverlap(settings.ragOverlap);
      setEmbeddingModel(settings.embeddingModel);
      setLeftSidebarOpen(settings.leftSidebarOpen ?? true);
      setRightSidebarOpen(settings.rightSidebarOpen ?? true);

      // 2) 兼容旧 localStorage 一次性迁移到 IndexedDB
      const legacy = loadLegacyBundleFromLocalStorage();
      if (legacy) {
        // 迁移原则：以“新设置层”为底，再合并 legacy 中可能存在的字段
        const mergedSettings: SettingsState = {
          ...settings,
          ...(legacy.settings ?? {}),
        };
        if (legacy.conversations?.length) {
          await replaceAllConversations(legacy.conversations);
        }
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(mergedSettings));
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // ignore
        }
        if (cancelled) return;
        setCurrentId(mergedSettings.currentId);
        setModel(mergedSettings.model);
        setSystemPrompt(mergedSettings.systemPrompt);
        setNumCtx(mergedSettings.numCtx);
        setRagEnabled(mergedSettings.ragEnabled);
        setRagTopK(mergedSettings.ragTopK);
        setRagChunkSize(mergedSettings.ragChunkSize);
        setRagOverlap(mergedSettings.ragOverlap);
        setEmbeddingModel(mergedSettings.embeddingModel);
        // visionModel 已移除，勾选图片时统一使用 VISION_MODEL
      }

      // 3) 加载会话（IndexedDB）
      const convs = await getAllConversations();
      if (cancelled) return;
      setConversations(convs);
      setCurrentId((cur) => cur ?? convs[0]?.id ?? null);

      // 4) 加载文档（IndexedDB）
      const storedDocs = await getAllDocs();
      if (cancelled) return;
      // 从 IndexedDB 读取时会为 pdf(blob) 重建 objectUrl，保证刷新后仍可预览
      const loadedDocs = storedDocs.map(toDocItem);
      setDocs(loadedDocs);
      setActiveDocId((cur) => cur ?? loadedDocs[0]?.id ?? null);

      setIsHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // docsRef 仅用于卸载时统一回收 objectUrl，避免闭包拿到旧 docs
    docsRef.current = docs;
  }, [docs]);

  useEffect(() => {
    // 组件卸载时清理 objectUrl，避免内存泄漏
    return () => {
      for (const d of docsRef.current) {
        if (d.objectUrl) URL.revokeObjectURL(d.objectUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          currentId,
          model,
          systemPrompt,
          numCtx,
          ragEnabled,
          ragTopK,
          ragChunkSize,
          ragOverlap,
          embeddingModel,
          leftSidebarOpen,
          rightSidebarOpen,
        }),
      );
    } catch {
      // localStorage 可能已满
    }
  }, [
    currentId,
    model,
    systemPrompt,
    numCtx,
    ragEnabled,
    ragTopK,
    ragChunkSize,
    ragOverlap,
    embeddingModel,
    leftSidebarOpen,
    rightSidebarOpen,
    isHydrated,
  ]);

  const currentConversation = conversations.find((c) => c.id === currentId);
  const messages = currentConversation?.messages ?? [];

  /**
   * 更新会话的统一入口（内存 state + IndexedDB 持久化）。
   * 设计为“传入 updater”：
   * - 便于在流式输出时高频更新最后一条 assistant 消息
   * - 避免分散在各处的 setConversations + DB 写入导致不一致
   */
  const updateConversation = useCallback(
    (id: string, updater: (c: Conversation) => Conversation) => {
      let nextConv: Conversation | null = null;
      setConversations((prev) => {
        const found = prev.find((c) => c.id === id);
        if (found) {
          nextConv = updater(found);
          return prev.map((c) => (c.id === id ? nextConv! : c));
        }
        const created: Conversation = {
          id,
          title: '新对话',
          messages: [],
        };
        nextConv = updater(created);
        return [nextConv, ...prev];
      });
      if (nextConv) {
        void upsertConversation(nextConv).catch(() => null);
      }
    },
    [],
  );

  /**
   * 生成会话标题（异步）：
   * - 当对话出现前两句后触发一次（见 send() 末尾）
   * - titleGenerated 用于“防重复触发/失败可重试”的状态标记
   */
  const fetchTitle = useCallback(
    async (convId: string, msgs: Message[]) => {
      if (msgs.length < 2) return;
      setConversations((prev) => {
        const found = prev.find((c) => c.id === convId);
        if (!found) return prev;
        const next = { ...found, titleGenerated: true };
        void upsertConversation(next).catch(() => null);
        return prev.map((c) => (c.id === convId ? next : c));
      });
      try {
        const res = await fetch('/api/title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs.slice(0, 2), model }),
        });
        if (!res.ok) {
          setConversations((prev) => {
            const found = prev.find((c) => c.id === convId);
            if (!found) return prev;
            const next = { ...found, titleGenerated: false };
            void upsertConversation(next).catch(() => null);
            return prev.map((c) => (c.id === convId ? next : c));
          });
          return;
        }
        const { title } = await res.json();
        if (title) {
          setConversations((prev) => {
            const found = prev.find((c) => c.id === convId);
            if (!found) return prev;
            const next = { ...found, title };
            void upsertConversation(next).catch(() => null);
            return prev.map((c) => (c.id === convId ? next : c));
          });
        }
      } catch {
        setConversations((prev) => {
          const found = prev.find((c) => c.id === convId);
          if (!found) return prev;
          const next = { ...found, titleGenerated: false };
          void upsertConversation(next).catch(() => null);
          return prev.map((c) => (c.id === convId ? next : c));
        });
      }
    },
    [model],
  );

  /** 新建空会话并切换为当前会话（同时写入 IndexedDB）。 */
  const createConversation = useCallback(() => {
    const newConv: Conversation = {
      id: generateId(),
      title: '新对话',
      messages: [],
    };
    setConversations((prev) => [newConv, ...prev]);
    setCurrentId(newConv.id);
    void upsertConversation(newConv).catch(() => null);
  }, []);

  /**
   * 删除会话：
   * - 需要 stopPropagation，避免触发 Sidebar 的 onSelect
   * - 若删除当前会话，则自动切到列表第一条（或置空）
   */
  const deleteConversation = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (currentId === id) {
          setCurrentId(next[0]?.id ?? null);
        }
        return next;
      });
      void removeConversationFromDb(id).catch(() => null);
    },
    [currentId],
  );

  /**
   * 发送消息主流程：
   * 1) 保障存在 activeId（无会话则自动创建）
   * 2) 写入 user 消息 + loading
   * 3) RAG（可选）：本地检索 -> 注入到 system prompt
   * 4) 调用 /api/chat 流式返回并持续更新 assistant 消息
   * 5) 结束后触发标题生成（若尚未生成）
   */
  const send = async () => {
    if (!input.trim() || isLoading) return;

    let activeId = currentId;
    if (!activeId) {
      const newConv: Conversation = {
        id: generateId(),
        title: '新对话',
        messages: [],
      };
      setConversations((prev) => [newConv, ...prev]);
      setCurrentId(newConv.id);
      void upsertConversation(newConv).catch(() => null);
      activeId = newConv.id;
    }

    const userMessage = input.trim();
    setInput('');
    const conv = conversations.find((c) => c.id === activeId) ?? {
      id: activeId,
      title: '新对话',
      messages: [],
    };
    const newMessages: Message[] = [
      ...conv.messages,
      { role: 'user', content: userMessage },
    ];
    updateConversation(activeId, () => ({ ...conv, messages: newMessages }));
    setCurrentId(activeId);
    setIsLoading(true);

    // 消息指令：在输入框中直接生成图片并插入对话
    // 约定：以 “生成” 开头，且包含 “图片”/“图”
    const parseImagePromptFromChat = (raw: string): string | null => {
      const t = raw.trim();
      if (!/^生成/i.test(t)) return null;
      if (!(t.includes('图片') || t.includes('图'))) return null;
      // 去掉前缀 “生成/生成图片/生成图/冒号”
      const cleaned = t
        .replace(/^生成(图片|图)?\s*[:：]?\s*/i, '')
        .replace(/^(一张|一幅|一批|一组)\s*/i, '')
        .replace(/^(图片|图)\s*/i, '')
        .trim();
      return cleaned ? cleaned : null;
    };

    const imagePrompt = parseImagePromptFromChat(userMessage);
    if (imagePrompt) {
      try {
        let lastErr: Error | null = null;
        let data: { imageBase64: string; mimeType: string } | null = null;

        for (const genModel of IMAGE_GEN_MODELS) {
          try {
            const res = await fetch('/api/image-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: imagePrompt, model: genModel }),
            });
            if (!res.ok) {
              const err = await res
                .json()
                .catch(() => ({ error: res.statusText }));
              throw new Error(err.error || `图片生成失败: ${res.status}`);
            }
            data = (await res.json()) as {
              imageBase64: string;
              mimeType: string;
            };
            break;
          } catch (e) {
            lastErr = e instanceof Error ? e : new Error('图片生成失败');
            data = null;
          }
        }

        if (!data?.imageBase64) {
          throw lastErr ?? new Error('图片生成失败：无可用图像生成模型');
        }

        const assistantMsg: Message = {
          role: 'assistant',
          content: '已根据你的描述生成图片如上：',
          images: [
            {
              mimeType: data.mimeType || 'image/png',
              base64: data.imageBase64.trim(),
            },
          ],
        };

        const finalMessages: Message[] = [...newMessages, assistantMsg];
        updateConversation(activeId, () => ({
          ...conv,
          messages: finalMessages,
        }));

        if (finalMessages.length >= 2 && !conv.titleGenerated) {
          fetchTitle(activeId, finalMessages);
        }
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '请求出错';
        const errorMessages: Message[] = [
          ...newMessages,
          { role: 'assistant', content: `错误: ${msg}` },
        ];
        updateConversation(activeId, () => ({
          ...conv,
          messages: errorMessages,
        }));
        return;
      }
    }

    // 仅携带「当前已上传且已勾选」的视觉媒体（图片/视频）；已删除或未勾选的不带入对话
    const selectedImageDocs = docs.filter(
      (d) => d.checked && d.kind === 'img' && !!d.blob,
    );
    const selectedVideoDocs = docs.filter(
      (d) => d.checked && d.kind === 'video' && !!d.blob,
    );
    const hasVisualMedia =
      selectedImageDocs.length > 0 || selectedVideoDocs.length > 0;

    try {
      // 勾选图片/视频时：走 /api/chat（多模态），支持多轮追问 + 流式输出
      // 发送前再校验一次（docsRef 为最新），避免用户已取消勾选/删除时仍带入旧媒体
      if (hasVisualMedia) {
        const currentImageDocs = docsRef.current.filter(
          (d) => d.checked && d.kind === 'img' && !!d.blob,
        );
        const currentVideoDocs = docsRef.current.filter(
          (d) => d.checked && d.kind === 'video' && !!d.blob,
        );

        const imageBases = await Promise.all(
          currentImageDocs.slice(0, 2).map((d) => blobToBase64(d.blob!)),
        );

        // 从视频抽帧，转成 base64 图片（base64 part，不带 dataURL 前缀）
        const videoFramesBases: string[] = [];
        if (currentVideoDocs.length > 0) {
          const frameDocs = currentVideoDocs.slice(0, 1);
          for (const d of frameDocs) {
            if (!d.objectUrl) continue;
            try {
              const frames = await extractVideoFramesBase64(d.objectUrl, {
                frameCount: 3,
                maxWidth: 768,
              });
              videoFramesBases.push(...frames);
            } catch {
              // 抽帧失败：忽略该视频，让后续仍可基于图片/文本继续
            }
          }
        }

        const combinedImages = [...imageBases, ...videoFramesBases].filter(
          Boolean,
        );
        if (combinedImages.length > 0) {
          const systemContent = (
            systemPrompt.trim() ||
            '请用中文分析并回答，结合用户上传并勾选的图片与视频帧进行分析作答。'
          ).trim();

          const usedVideo =
            currentVideoDocs.length > 0 && videoFramesBases.length > 0;

          type VisionMessage = Message & { images?: string[] };
          const messagesWithImages: VisionMessage[] = newMessages.map(
            (m, i) => {
              const isLastUser =
                i === newMessages.length - 1 && m.role === 'user';
              if (isLastUser) {
                return {
                  ...m,
                  role: 'user' as const,
                  content: usedVideo
                    ? `请用中文分析并回答：${m.content}`
                    : `请用中文描述并回答：${m.content}`,
                  images: combinedImages,
                };
              }
              return m;
            },
          );

          const messagesToSend =
            systemContent === ''
              ? messagesWithImages
              : [
                  { role: 'system' as const, content: systemContent },
                  ...messagesWithImages,
                ];

          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: messagesToSend,
              model: VISION_MODEL,
              options: { num_ctx: numCtx },
            }),
          });
          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `视觉分析失败: ${res.status}`);
          }

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let assistantContent = '';
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              assistantContent += decoder.decode(value, { stream: true });
              const updated: Message[] = [
                ...newMessages,
                { role: 'assistant', content: assistantContent },
              ];
              updateConversation(activeId, () => ({
                ...conv,
                messages: updated,
              }));
            }
          }
          const finalMessages: Message[] = assistantContent
            ? [...newMessages, { role: 'assistant', content: assistantContent }]
            : [...newMessages, { role: 'assistant', content: '(无回复内容)' }];
          updateConversation(activeId, () => ({
            ...conv,
            messages: finalMessages,
          }));
          if (finalMessages.length >= 2 && !conv.titleGenerated) {
            fetchTitle(activeId, finalMessages);
          }
          return;
        }
        // 抽帧失败或未带入媒体：回落到纯文本/RAG
      }

      // 无视觉媒体勾选（或校验时已取消 / 抽帧失败）：走 chat 流程（RAG + system prompt）
      const trimmedSystem = systemPrompt.trim();
      let contextPrefix = '';
      if (ragEnabled && selectedDocs.length > 0) {
        try {
          const hits = await retrieveRagHits({
            query: userMessage,
            docs: selectedDocs,
            topK: ragTopK,
            chunkSize: ragChunkSize,
            overlap: ragOverlap,
            embeddingModel,
          });
          setRagError(null);
          setRagHits(hits);
          const lines = hits
            .map(
              (c, idx) =>
                `【片段${idx + 1}｜${c.docName}${c.pageStart ? `｜p${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}` : ''}${c.heading ? `｜${c.heading}` : ''}｜score=${c.score.toFixed(3)}】\n${c.chunk}`,
            )
            .join('\n\n');
          if (lines) {
            contextPrefix = `请仅根据以下检索到的资料回答问题（若资料不足请说明）：\n${lines}\n\n`;
          }
        } catch (e) {
          setRagError(e instanceof Error ? e.message : 'RAG 请求异常');
          setRagHits([]);
        }
      }
      if (!contextPrefix) {
        contextPrefix = selectedDocsContent
          ? `请根据以下资料回答问题：\n${selectedDocsContent}\n\n`
          : '';
      }
      const effectiveSystem = (contextPrefix + trimmedSystem).trim();
      const messagesToSend =
        effectiveSystem === ''
          ? newMessages
          : [{ role: 'system', content: effectiveSystem }, ...newMessages];

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesToSend,
          model,
          options: { num_ctx: numCtx },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `请求失败: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantContent += decoder.decode(value, { stream: true });
          const updated: Message[] = [
            ...newMessages,
            { role: 'assistant', content: assistantContent },
          ];
          updateConversation(activeId, () => ({ ...conv, messages: updated }));
        }
      }
      const finalMessages: Message[] = assistantContent
        ? [...newMessages, { role: 'assistant', content: assistantContent }]
        : [...newMessages, { role: 'assistant', content: '(无回复内容)' }];
      updateConversation(activeId, () => ({
        ...conv,
        messages: finalMessages,
      }));
      if (finalMessages.length >= 2 && !conv.titleGenerated) {
        fetchTitle(activeId, finalMessages);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '请求出错';
      const errorMessages: Message[] = [
        ...newMessages,
        { role: 'assistant', content: `错误: ${msg}` },
      ];
      updateConversation(activeId, () => ({
        ...conv,
        messages: errorMessages,
      }));
      if (errorMessages.length >= 2 && !conv.titleGenerated) {
        fetchTitle(activeId, errorMessages);
      }
    } finally {
      setIsLoading(false);
    }
  };;

  /** 输入框发送入口：仅在“有内容且不在 loading”时触发 send()。 */
  const handleSendFromInput = () => {
    if (input.trim() && !isLoading) send();
  };

  /**
   * 从 File 构建 DocItem：
   * - txt/md：直接读取文本
   * - pdf：用 pdfjs 解析每页文本（用于 RAG/页码引用），同时保存 blob 以便刷新后预览
   */
  const addDocFromFile = async (file: File) => {
    const id = generateId();
    let content = '';
    let kind: DocItem['kind'] = 'txt';
    let objectUrl: string | undefined;
    let pages: DocItem['pages'];
    let blob: Blob | undefined;

    // 图片：先做“上传 + 预览 + 持久化”，后续再叠加 OCR -> content -> RAG
    if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      kind = 'img';
      blob = file;
      objectUrl = URL.createObjectURL(file);
      content = '';
    } else if (/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      // 视频：不做自动转写/抽帧持久化，抽帧发生在用户“发送问题”时
      kind = 'video';
      blob = file;
      objectUrl = URL.createObjectURL(file);
      content = '';
    } else if (/\.pdf$/i.test(file.name)) {
      kind = 'pdf';
      // PDF 需要持久化 blob：
      // - 右侧预览依赖 objectUrl，但 objectUrl 不能跨刷新保存
      // - 保存 blob 到 IndexedDB 后，刷新时可以重建 objectUrl，实现“文档仍可预览”
      blob = file;
      objectUrl = URL.createObjectURL(file);
      const pdfjs = await import('pdfjs-dist');
      if (typeof window !== 'undefined') {
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      const extractedPages: Array<{ page: number; text: string }> = [];
      for (let i = 1; i <= pdf.numPages; i += 1) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = (textContent.items as Array<{ str?: string }>)
          .map((item) => item.str ?? '')
          .join(' ');
        extractedPages.push({ page: i, text: pageText });
        fullText += `${pageText}\n`;
      }
      content = fullText;
      pages = extractedPages;
    } else if (/\.md$/i.test(file.name)) {
      kind = 'md';
      content = await file.text();
    } else if (/\.txt$/i.test(file.name)) {
      kind = 'txt';
      content = await file.text();
    } else {
      return;
    }

    const doc: DocItem = {
      id,
      name: file.name,
      content,
      kind,
      objectUrl,
      blob,
      pages,
      checked: true,
      visionSummary: '',
      visionStatus: 'none',
    };

    setDocs((prev) => [doc, ...prev]);
    setActiveDocId((prev) => prev ?? id);
    void upsertDoc({
      id,
      name: file.name,
      content,
      kind,
      pages,
      checked: true,
      blob,
      visionSummary: '',
      visionStatus: 'none',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch(() => null);
  };

  /** Blob -> base64（用于把图片附在 /api/chat 的 user 消息上）。 */
  const blobToBase64 = async (b: Blob): Promise<string> => {
    const ab = await b.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(ab);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  /**
   * 视频抽帧 -> base64 图片（base64 part，不带 dataURL 前缀）
   * - 用于把本地视频“变成图片数组”，再复用现有 /api/chat 多模态能力
   */
  const extractVideoFramesBase64 = async (
    videoSrc: string,
    params: { frameCount: number; maxWidth: number },
  ): Promise<string[]> => {
    const { frameCount, maxWidth } = params;
    if (!frameCount || frameCount < 1) return [];

    const video = document.createElement('video');
    video.src = videoSrc;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const waitForLoadedMetadata = () =>
      new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        const onError = () => {
          video.removeEventListener('error', onError);
          reject(new Error('video loadedmetadata failed'));
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError);
      });

    await waitForLoadedMetadata();

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const videoW = video.videoWidth || 640;
    const videoH = video.videoHeight || 480;

    if (!duration || duration <= 0) return [];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const scale = Math.min(1, maxWidth / Math.max(1, videoW));
    canvas.width = Math.max(1, Math.floor(videoW * scale));
    canvas.height = Math.max(1, Math.floor(videoH * scale));

    const times = Array.from({ length: frameCount }, (_, idx) => {
      const t = frameCount === 1 ? 0.5 : idx / (frameCount - 1);
      // 避免取到视频开头/结尾黑帧：加一点点偏移
      return Math.max(0, Math.min(duration, t * duration));
    });

    const seekTo = (time: number) =>
      new Promise<void>((resolve, reject) => {
        const onError = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          reject(new Error('video seek failed'));
        };

        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.currentTime = Math.max(0, Math.min(duration, time));
      });

    const frames: string[] = [];

    for (const t of times) {
      try {
        await seekTo(t);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        if (base64) frames.push(base64);
      } catch {
        // 单帧失败不应中断全流程
      }
    }

    try {
      video.pause();
      video.src = '';
    } catch {
      // ignore
    }

    return frames;
  };

  /**
   * 图片生成入口：调用 /api/image-generate，把结果作为 assistant 附件插入对话。
   * （不写入右侧“文档栏”，从而满足“在消息对话中展示”）
   */
  const handleGenerateImage = async (prompt: string) => {
    if (isLoading) throw new Error('当前正在对话中，请稍后再生成图片');

    let activeId = currentId;
    let existingConv = currentId
      ? conversations.find((c) => c.id === currentId)
      : null;
    let baseMessages: Message[] = existingConv?.messages ?? [];

    if (!activeId) {
      existingConv = null;
      baseMessages = [];
      activeId = generateId();
      setCurrentId(activeId);
    }

    try {
      let lastErr: Error | null = null;
      let data: { imageBase64: string; mimeType: string } | null = null;

      for (const genModel of IMAGE_GEN_MODELS) {
        try {
          const res = await fetch('/api/image-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, model: genModel }),
          });
          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `图片生成失败: ${res.status}`);
          }
          data = (await res.json()) as {
            imageBase64: string;
            mimeType: string;
          };
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error('图片生成失败');
          data = null;
        }
      }

      if (!data?.imageBase64) {
        throw lastErr ?? new Error('图片生成失败：无可用图像生成模型');
      }

      const imageBase64 = data.imageBase64.trim();
      const mimeType = data.mimeType || 'image/png';
      if (!imageBase64) throw new Error('生成结果为空');

      const assistantMsg: Message = {
        role: 'assistant',
        content: '已根据你的描述生成图片如上：',
        images: [
          {
            mimeType,
            base64: imageBase64,
          },
        ],
      };

      updateConversation(activeId, (c) => ({
        ...c,
        messages: [...c.messages, assistantMsg],
      }));

      const finalMessages = [...baseMessages, assistantMsg];
      if (
        finalMessages.length >= 2 &&
        !(existingConv?.titleGenerated ?? false)
      ) {
        fetchTitle(activeId, finalMessages);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '图片生成出错';
      const assistantMsg: Message = {
        role: 'assistant',
        content: `错误: ${msg}`,
      };
      updateConversation(activeId!, (c) => ({
        ...c,
        messages: [...c.messages, assistantMsg],
      }));
    }
  };

  // 图片/视频分析仅依赖视觉模型（VLM）。

  /**
   * 上传文件 change handler：
   * - 解析后把 input.value 清空，保证“选择同一个文件”也能再次触发 change
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    try {
      await addDocFromFile(file);
    } finally {
      inputEl.value = '';
    }
  };

  /**
   * 切换文档是否参与上下文注入（checked）：
   * - 更新 UI 状态
   * - 同步写入 IndexedDB，保证刷新后仍保持勾选
   */
  const toggleDocChecked = (id: string) => {
    setDocs((prev) => {
      const target = prev.find((d) => d.id === id);
      if (!target) return prev;
      const nextDoc = { ...target, checked: !target.checked };
      void upsertDoc({
        id: nextDoc.id,
        name: nextDoc.name,
        content: nextDoc.content,
        kind: nextDoc.kind,
        pages: nextDoc.pages,
        checked: nextDoc.checked,
        blob: nextDoc.blob,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }).catch(() => null);
      return prev.map((d) => (d.id === id ? nextDoc : d));
    });
  };

  /**
   * 删除文档：
   * - 先 revoke objectUrl 释放内存
   * - 若删除的是当前预览文档，则切到下一条/置空
   * - 同步删除 IndexedDB 记录
   */
  const removeDoc = (id: string) => {
    setDocs((prev) => {
      const target = prev.find((d) => d.id === id);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      const next = prev.filter((d) => d.id !== id);
      setActiveDocId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });
    void removeDocFromDb(id).catch(() => null);
  };

  // 图片上传后无需自动分析，分析在用户发问时通过 /api/chat（多模态）实时完成。

  if (!isHydrated) {
    return (
      <main className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <span className="text-zinc-400">加载中...</span>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={setCurrentId}
        onCreate={createConversation}
        onDelete={deleteConversation}
        collapsed={!leftSidebarOpen}
        onToggle={() => setLeftSidebarOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        {/* 顶部栏 */}
        <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {currentConversation?.title ?? 'My Local AI'}
            </h1>
            <div className="flex items-center gap-2">
              <SettingsDialog
                model={model}
                setModel={setModel}
                chatModels={MODELS}
                systemPrompt={systemPrompt}
                setSystemPrompt={setSystemPrompt}
                ragEnabled={ragEnabled}
                setRagEnabled={setRagEnabled}
                ragTopK={ragTopK}
                setRagTopK={setRagTopK}
                ragChunkSize={ragChunkSize}
                setRagChunkSize={setRagChunkSize}
                ragOverlap={ragOverlap}
                setRagOverlap={setRagOverlap}
                embeddingModel={embeddingModel}
                setEmbeddingModel={setEmbeddingModel}
                ragError={ragError}
                numCtx={numCtx}
                setNumCtx={setNumCtx}
              />
            </div>
          </div>
        </header>
        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          input={input}
          onInputChange={setInput}
          onSend={handleSendFromInput}
          onFileChange={handleFileChange}
          docs={docs}
          activeDocId={activeDocId}
          onSetActiveDoc={setActiveDocId}
          onToggleDoc={toggleDocChecked}
          onRemoveDoc={removeDoc}
          isContextTooLong={isContextTooLong}
          ragEnabled={ragEnabled}
          ragHits={ragHits}
          rightSidebarOpen={rightSidebarOpen}
          onToggleRightSidebar={() => setRightSidebarOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendFromInput();
            }
          }}
        />
      </div>
    </main>
  );
}
