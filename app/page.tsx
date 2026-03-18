'use client';

import { useState, useEffect, useCallback } from 'react';
import { ModelSelect } from '@/components/ModelSelect';
import { Sidebar } from '@/components/Sidebar';
import { ChatWindow } from '@/components/ChatWindow';
import { SettingsDialog } from '@/components/SettingsDialog';
import type { Conversation, Message, DocItem } from '@/lib/types';

const STORAGE_KEY = 'ai-local-app-chat';

const MODELS = [
  { id: 'deepseek-r1', name: 'DeepSeek R1' },
  { id: 'gemma2', name: 'Gemma 2' },
  { id: 'qwen2.5', name: 'Qwen 2.5' },
  { id: 'mistral', name: 'Mistral' },
  { id: 'llama3.2', name: 'Llama 3.2' },
  { id: 'llama3.1', name: 'Llama 3.1' },
];

function generateId() {
  return (
    crypto.randomUUID?.() ??
    `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function loadFromStorage(): {
  conversations: Conversation[];
  currentId: string | null;
  model: string;
  systemPrompt: string;
  numCtx: number;
  ragEnabled: boolean;
  ragTopK: number;
  ragChunkSize: number;
  ragOverlap: number;
  embeddingModel: string;
} {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored)
      return {
        conversations: [],
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
    const data = JSON.parse(stored);
    if (
      Array.isArray(data.chat) &&
      data.chat.length > 0 &&
      !data.conversations
    ) {
      const conv: Conversation = {
        id: generateId(),
        title: '历史对话',
        messages: data.chat,
      };
      return {
        conversations: [conv],
        currentId: conv.id,
        model: data.model ?? 'deepseek-r1',
        systemPrompt: data.systemPrompt ?? '',
        numCtx: data.numCtx ?? 8192,
        ragEnabled: data.ragEnabled ?? false,
        ragTopK: data.ragTopK ?? 4,
        ragChunkSize: data.ragChunkSize ?? 900,
        ragOverlap: data.ragOverlap ?? 150,
        embeddingModel: data.embeddingModel ?? 'mxbai-embed-large',
      };
    }
    const conversations = Array.isArray(data.conversations)
      ? data.conversations
      : [];
    return {
      conversations,
      currentId: data.currentId ?? conversations[0]?.id ?? null,
      model: data.model ?? 'deepseek-r1',
      systemPrompt: data.systemPrompt ?? '',
      numCtx: data.numCtx ?? 8192,
      ragEnabled: data.ragEnabled ?? false,
      ragTopK: data.ragTopK ?? 4,
      ragChunkSize: data.ragChunkSize ?? 900,
      ragOverlap: data.ragOverlap ?? 150,
      embeddingModel: data.embeddingModel ?? 'mxbai-embed-large',
    };
  } catch {
    return {
      conversations: [],
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
  }
}

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

  const selectedDocs = docs.filter((d) => d.checked);
  const selectedDocsContent = selectedDocs.map((d) => d.content).join('\n\n');
  const selectedDocsCharCount = selectedDocsContent.length;
  const isContextTooLong = selectedDocsCharCount > 5000;

  useEffect(() => {
    const data = loadFromStorage();
    setConversations(data.conversations);
    setCurrentId(data.currentId);
    setModel(data.model);
    setSystemPrompt(data.systemPrompt);
    setNumCtx(data.numCtx);
    setRagEnabled(data.ragEnabled);
    setRagTopK(data.ragTopK);
    setRagChunkSize(data.ragChunkSize);
    setRagOverlap(data.ragOverlap);
    setEmbeddingModel(data.embeddingModel);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          conversations,
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
    conversations,
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

  const updateConversation = useCallback(
    (id: string, updater: (c: Conversation) => Conversation) => {
      setConversations((prev) => {
        const found = prev.find((c) => c.id === id);
        if (found) {
          return prev.map((c) => (c.id === id ? updater(c) : c));
        }
        const created: Conversation = {
          id,
          title: '新对话',
          messages: [],
        };
        return [updater(created), ...prev];
      });
    },
    [],
  );

  const fetchTitle = useCallback(
    async (convId: string, msgs: Message[]) => {
      if (msgs.length < 2) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, titleGenerated: true } : c)),
      );
      try {
        const res = await fetch('/api/title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs.slice(0, 2), model }),
        });
        if (!res.ok) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId ? { ...c, titleGenerated: false } : c,
            ),
          );
          return;
        }
        const { title } = await res.json();
        if (title) {
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title } : c)),
          );
        }
      } catch {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, titleGenerated: false } : c,
          ),
        );
      }
    },
    [model],
  );

  const createConversation = useCallback(() => {
    const newConv: Conversation = {
      id: generateId(),
      title: '新对话',
      messages: [],
    };
    setConversations((prev) => [newConv, ...prev]);
    setCurrentId(newConv.id);
  }, []);

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
    },
    [currentId],
  );

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
        const res = await fetch('/api/rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: userMessage,
            docs: selectedDocs.map((d) => ({
              id: d.id,
              name: d.name,
              content: d.content,
              kind: d.kind,
              pages: d.pages,
            })),
            topK: ragTopK,
            chunkSize: ragChunkSize,
            overlap: ragOverlap,
            embeddingModel,
          }),
        });
        if (res.ok) {
          setRagError(null);
          const data = (await res.json()) as {
            chunks: Array<{
              docId: string;
              docName: string;
              chunk: string;
              score: number;
              pageStart?: number;
              pageEnd?: number;
              heading?: string;
            }>;
          };
          setRagHits(data.chunks ?? []);
          const lines = (data.chunks ?? [])
            .map(
              (c, idx) =>
                `【片段${idx + 1}｜${c.docName}${c.pageStart ? `｜p${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}` : ''}${c.heading ? `｜${c.heading}` : ''}｜score=${c.score.toFixed(3)}】\n${c.chunk}`,
            )
            .join('\n\n');
          if (lines) {
            contextPrefix = `请仅根据以下检索到的资料回答问题（若资料不足请说明）：\n${lines}\n\n`;
          }
        } else {
          const err = await res.json().catch(() => null as any);
          const msg = err?.error ?? res.statusText;
          setRagError(String(msg));
          setRagHits([]);
          console.warn('RAG 请求失败，将降级为全量注入', msg);
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

  const handleSendFromInput = () => {
    if (input.trim() && !isLoading) send();
  };

  const addDocFromFile = async (file: File) => {
    const id = generateId();
    let content = '';
    let kind: DocItem['kind'] = 'txt';
    let objectUrl: string | undefined;
    let pages: DocItem['pages'];

    if (/\.pdf$/i.test(file.name)) {
      kind = 'pdf';
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
      pages,
      checked: true,
    };

    setDocs((prev) => [doc, ...prev]);
    setActiveDocId((prev) => prev ?? id);
  };

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

  const toggleDocChecked = (id: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, checked: !d.checked } : d)),
    );
  };

  const removeDoc = (id: string) => {
    setDocs((prev) => {
      const target = prev.find((d) => d.id === id);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      const next = prev.filter((d) => d.id !== id);
      setActiveDocId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });
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
