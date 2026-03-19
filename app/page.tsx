'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelSelect } from '@/components/ModelSelect';
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

  const selectedDocs = docs.filter((d) => d.checked);
  const selectedDocsContent = selectedDocs.map((d) => d.content).join('\n\n');
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

    const trimmedSystem = systemPrompt.trim();

    let contextPrefix = '';
    if (ragEnabled && selectedDocs.length > 0) {
      try {
        // RAG 选择在前端本地做：
        // - 文档/切片与 embedding 缓存都在 IndexedDB，避免每次都把大文档传回服务端
        // - embedding 请求仍通过 /api/embed 走本机 Ollama，但命中缓存时不会重复计算
        // - 引用信息（页码/标题）可直接用于右侧“论文式引用”跳转与高亮
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
        // RAG 失败则降级为全量注入（保持可用性）
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

    try {
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
  };

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

    if (/\.pdf$/i.test(file.name)) {
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
        const pageText = (textContent.items as any[])
          .map((item) => item.str)
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).catch(() => null);
  };

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
      />
      <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        {/* 顶部栏 */}
        <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {currentConversation?.title ?? 'My Local AI'}
            </h1>
            <div className="flex items-center gap-2">
              <ModelSelect value={model} onChange={setModel} options={MODELS} />
              <SettingsDialog
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
