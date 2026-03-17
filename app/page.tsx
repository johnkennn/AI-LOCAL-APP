'use client';

import { useState, useEffect, useCallback } from 'react';
import { ModelSelect } from '@/components/ModelSelect';
import { Sidebar } from '@/components/Sidebar';
import { ChatWindow } from '@/components/ChatWindow';
import type { Conversation, Message } from '@/lib/types';

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
} {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored)
      return {
        conversations: [],
        currentId: null,
        model: 'deepseek-r1',
        systemPrompt: '',
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
    };
  } catch {
    return {
      conversations: [],
      currentId: null,
      model: 'deepseek-r1',
      systemPrompt: '',
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
  const [showSettings, setShowSettings] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');

  useEffect(() => {
    const data = loadFromStorage();
    setConversations(data.conversations);
    setCurrentId(data.currentId);
    setModel(data.model);
    setSystemPrompt(data.systemPrompt);
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
        }),
      );
    } catch {
      // localStorage 可能已满
    }
  }, [conversations, currentId, model, systemPrompt, isHydrated]);

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
    // 新对话默认不挂载旧文档
    setFileName(null);
    setFileContent('');
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
    const contextPrefix = fileContent
      ? `请根据以下资料回答问题：\n${fileContent}\n\n`
      : '';
    const effectiveSystem = (contextPrefix + trimmedSystem).trim();

    const messagesToSend =
      effectiveSystem === ''
        ? newMessages
        : [{ role: 'system', content: effectiveSystem }, ...newMessages];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend, model }),
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
      // 单轮问答级别的文档挂载，用完即清理
      setFileName(null);
      setFileContent('');
    }
  };

  const handleSendFromInput = () => {
    if (input.trim() && !isLoading) send();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    try {
      let text = '';
      if (/\.pdf$/i.test(file.name)) {
        const pdfjs = await import('pdfjs-dist');
        if (typeof window !== 'undefined') {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = (textContent.items as any[])
            .map((item) => item.str)
            .join(' ');
          fullText += `${pageText}\n`;
        }
        text = fullText;
      } else if (/\.(txt|md)$/i.test(file.name)) {
        text = await file.text();
      } else {
        setFileName(null);
        setFileContent('');
        inputEl.value = '';
        return;
      }
      setFileName(file.name);
      setFileContent(text);
    } finally {
      // 允许选择同一个文件时也能触发 onChange
      inputEl.value = '';
    }
  };

  const clearFile = () => {
    setFileName(null);
    setFileContent('');
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
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  showSettings
                    ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                title="系统设定"
              >
                ⚙ 设定提示词
              </button>
            </div>
          </div>
          {showSettings && (
            <div className="mx-auto mt-3 max-w-3xl">
              <input
                type="text"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="系统提示词，如：你是一个精通 JavaScript 的架构师"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/80 px-3 py-2 text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </header>
        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          input={input}
          onInputChange={setInput}
          onSend={handleSendFromInput}
          fileName={fileName}
          onFileChange={handleFileChange}
          onClearFile={clearFile}
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
