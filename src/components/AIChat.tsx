import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, Send, Copy, Check, Plus, MessageSquare, Trash2, Pencil, Maximize2, Minimize2, History } from 'lucide-react';
import echoIcon from '../assets/echo-ai.webp';
import { useAuth } from '../contexts/AuthContext';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

const ECHO_SYSTEM_PROMPT = [
  'You are Echo, the AI assistant for the Scorpion DevSecOps platform.',
  'Answer questions about scans, vulnerabilities, and remediations accurately.',
  'Match answer depth to the question: greetings and quick facts get 1-2 sentences;',
  'how-to and overview questions get a complete, structured answer — every bullet must carry a concrete, actionable detail (what it does AND how to use it), not just a label.',
  'Stay scannable: **bold** key terms, `-` bullets, short `code` spans, no filler sentences, no nesting deeper than one level, no restating the question.',
  'End big topics with a pointed follow-up offer, e.g. "Want the exact steps for X?"',
].join(' ');

const SUGGESTIONS = [
  'What are my critical findings?',
  "Summarize today's scan",
  'How do I fix the JWT secret issue?',
];

// Scorpion Light design system — stone canvas, white surfaces, hairline
// borders, single indigo accent. Mirrors the tokens in src/index.css.
const C = {
  bg: 'var(--bg-page)',
  surface: 'var(--bg-card)',
  surfaceHigh: 'var(--bg-secondary)',
  border: 'var(--border-subtle)',
  text: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  primary: 'var(--accent-primary)',
  primaryHover: 'var(--accent-secondary)',
  primaryText: 'var(--text-on-accent)',
  success: 'var(--status-success)',
  shadow: 'var(--card-shadow)',
  body: 'var(--font-body)',
  mono: 'var(--font-mono)',
};

type AIChatProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
};

const titleFromMessage = (text: string) => (text.length > 42 ? `${text.slice(0, 42)}…` : text);

// Sessions saved before mid-2026 used { role, content } instead of
// { id, role, text } — normalize both shapes so old chats still render.
const normalizeStoredMessages = (raw: string): ChatMessage[] => {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m, i) => ({
      id: typeof m?.id === 'string' ? m.id : `legacy-${i}`,
      role: m?.role === 'user' ? 'user' : 'assistant',
      text: typeof m?.text === 'string' ? m.text : (typeof m?.content === 'string' ? m.content : ''),
    }));
  } catch {
    return [];
  }
};

const AIChat: React.FC<AIChatProps> = ({ open, setOpen }) => {
  const { getJWT, user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Compact panel by default; fullscreen on demand. Remembered across opens.
  const [isExpanded, setIsExpanded] = useState<boolean>(() => localStorage.getItem('echoChatExpanded') === 'true');
  // Compact mode has no sidebar — History toggles an in-panel session list.
  const [showHistory, setShowHistory] = useState(false);
  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      localStorage.setItem('echoChatExpanded', String(!prev));
      return !prev;
    });
    setShowHistory(false);
  };
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = textareaRef.current;
    // Skip while hidden: display:none reports scrollHeight 0 and would lock
    // the textarea at zero height, clipping the text when the chat opens.
    if (!el || !open) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input, open]);

  useEffect(() => {
    if (!open || !user) return;
    databases.listDocuments(DB_ID, COLLECTIONS.CHAT_SESSIONS, [
      Query.equal('userId', user.$id),
      Query.orderDesc('$updatedAt'),
      Query.limit(30),
    ]).then((res) => {
      setSessions(res.documents.map((d: any) => ({
        id: d.$id,
        title: d.title || 'Untitled chat',
        messages: normalizeStoredMessages(d.messages),
      })));
    }).catch((err) => console.warn('[Echo] failed to load chat history:', err?.message || err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const persistSession = async (history: ChatMessage[], sessionId: string | null) => {
    if (!user) return sessionId;
    const payload = {
      sessionId: crypto.randomUUID(),
      userId: user.$id,
      title: titleFromMessage(history[0]?.text || 'Untitled chat'),
      messages: JSON.stringify(history),
      createdAt: new Date().toISOString(),
    };
    try {
      if (sessionId) {
        await databases.updateDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, sessionId, { messages: payload.messages });
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, messages: history } : s)));
        return sessionId;
      }
      const doc = await databases.createDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, ID.unique(), payload);
      setSessions((prev) => [{ id: doc.$id, title: payload.title, messages: history }, ...prev]);
      return doc.$id;
    } catch (err) {
      console.warn('[Echo] failed to save chat session:', err instanceof Error ? err.message : err);
      return sessionId;
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    const userMessage: ChatMessage = { id: `${Date.now()}`, role: 'user', text };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsLoading(true);

    const replyId = `${Date.now()}-reply`;
    let replyText = '';
    const appendToReply = (delta: string) => {
      replyText += delta;
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === replyId);
        const replyMsg: ChatMessage = { id: replyId, role: 'assistant', text: replyText };
        return exists ? prev.map((m) => (m.id === replyId ? replyMsg : m)) : [...prev, replyMsg];
      });
    };

    try {
      const token = await getJWT();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          systemPrompt: ECHO_SYSTEM_PROMPT,
          messages: history.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.text }],
          })),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        appendToReply(data.error || 'Echo is unavailable right now.');
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Gemini SSE delimits events with \r\n\r\n — split on either form.
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? '';
          for (const event of events) {
            const line = event.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const chunk = JSON.parse(line.slice(6));
              const delta = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
              if (delta) appendToReply(delta);
            } catch { /* partial/non-JSON chunk, skip */ }
          }
        }
        if (!replyText) appendToReply("I couldn't find anything for that.");
      }
    } catch {
      appendToReply('Echo is unavailable right now — check your connection and try again.');
    }

    setIsLoading(false);
    setMessages((prev) => {
      const finalHistory = prev;
      persistSession(finalHistory, activeSessionId).then((savedId) => {
        if (savedId) setActiveSessionId(savedId);
      });
      return finalHistory;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {}
  };

  // Claude-style edit: load the message into the composer and rewind the
  // conversation to just before it; sending re-asks from that point.
  const handleEditMessage = (message: ChatMessage) => {
    if (isLoading) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === message.id);
      return idx === -1 ? prev : prev.slice(0, idx);
    });
    setInput(message.text);
    textareaRef.current?.focus();
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
    setActiveSessionId(null);
  };

  const handleSelectSession = (session: ChatSession) => {
    setMessages(session.messages);
    setActiveSessionId(session.id);
    setInput('');
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) handleNewChat();
    try {
      await databases.deleteDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, sessionId);
    } catch {}
  };

  // Shared between the fullscreen sidebar and the compact History overlay.
  const sessionList = sessions.length === 0 ? (
    <p className="text-xs px-1 py-2" style={{ color: C.textMuted }}>No conversations yet.</p>
  ) : (
    sessions.map((s) => (
      <button
        key={s.id}
        type="button"
        onClick={() => { handleSelectSession(s); setShowHistory(false); }}
        className="group w-full flex items-center gap-2.5 px-2.5 py-2 text-left text-xs rounded-lg transition-colors duration-150 hover:bg-[var(--bg-secondary)]"
        style={{
          background: activeSessionId === s.id ? C.surfaceHigh : 'transparent',
          color: activeSessionId === s.id ? C.text : C.textSecondary,
          fontWeight: activeSessionId === s.id ? 600 : 400,
        }}
      >
        <MessageSquare size={13} className="shrink-0" style={{ color: activeSessionId === s.id ? C.primary : C.textMuted }} />
        <span className="flex-1 truncate">{s.title}</span>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => handleDeleteSession(e, s.id)}
          aria-label="Delete conversation"
          className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity hover:text-[var(--status-error)]"
          style={{ color: C.textMuted }}
        >
          <Trash2 size={12} />
        </span>
      </button>
    ))
  );

  return (
    <div
      className={`fixed ${open ? 'flex' : 'hidden'} z-50 ${
        isExpanded
          ? 'inset-0'
          : 'bottom-5 right-5 w-[440px] max-w-[calc(100vw-2.5rem)] h-[660px] max-h-[calc(100vh-2.5rem)] rounded-2xl border shadow-2xl overflow-hidden'
      }`}
      style={{ background: C.bg, fontFamily: C.body, ...(isExpanded ? {} : { borderColor: C.border }) }}
    >
      {/* Sidebar: new chat + history (fullscreen only) */}
      <aside className={`${isExpanded ? 'hidden md:flex' : 'hidden'} flex-col w-72 shrink-0 border-r px-4 pt-5 pb-4`} style={{ borderColor: C.border, background: C.surface }}>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center justify-center gap-2 px-3 py-2.5 mb-6 text-sm font-semibold rounded-lg transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
          style={{ background: C.primary, color: C.primaryText, boxShadow: C.shadow }}
        >
          <Plus size={15} /> New chat
        </button>
        <p className="text-[10px] font-medium tracking-widest uppercase mb-2 px-1" style={{ color: C.textMuted, fontFamily: C.mono }}>Recents</p>
        <div className="flex-1 overflow-y-auto space-y-0.5 -mx-1 px-1">{sessionList}</div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Compact-mode history overlay */}
        {!isExpanded && showHistory && (
          <div
            className="absolute inset-x-0 top-[65px] bottom-0 z-10 flex flex-col px-4 pt-4 pb-4 overflow-y-auto"
            style={{ background: C.bg }}
          >
            <p className="text-[10px] font-medium tracking-widest uppercase mb-2 px-1" style={{ color: C.textMuted, fontFamily: C.mono }}>Recents</p>
            <div className="space-y-0.5">{sessionList}</div>
          </div>
        )}
        {/* Header */}
        <div className="w-full flex justify-between items-center border-b px-5 py-3.5 shrink-0" style={{ borderColor: C.border, background: C.surface }}>
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 flex items-center justify-center rounded-xl border shrink-0"
              style={{ background: C.surfaceHigh, borderColor: C.border }}
            >
              <img src={echoIcon} alt="" width={22} height={22} className="w-[22px] h-[22px]" style={{ mixBlendMode: 'multiply' }} />
            </span>
            <div className="min-w-0 leading-tight">
              <h2 className="text-sm font-semibold tracking-tight" style={{ color: C.text }}>Echo</h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>Security intelligence assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase" style={{ color: C.textMuted, fontFamily: C.mono }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.success }} />
              Online
            </span>
            <button
              type="button"
              onClick={() => { handleNewChat(); setShowHistory(false); }}
              aria-label="New chat"
              title="New chat"
              className={`${isExpanded ? 'md:hidden' : ''} p-2 rounded-lg transition-colors duration-150 hover:bg-[var(--bg-secondary)]`}
              style={{ color: C.textSecondary }}
            >
              <Plus size={16} />
            </button>
            {!isExpanded && (
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                aria-label="Chat history"
                title="Chat history"
                className="p-2 rounded-lg transition-colors duration-150 hover:bg-[var(--bg-secondary)]"
                style={{ color: showHistory ? C.primary : C.textSecondary, background: showHistory ? C.surfaceHigh : undefined }}
              >
                <History size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label={isExpanded ? 'Minimize chat' : 'Maximize chat'}
              title={isExpanded ? 'Minimize' : 'Maximize'}
              className="p-2 rounded-lg transition-colors duration-150 hover:bg-[var(--bg-secondary)]"
              style={{ color: C.textSecondary }}
            >
              {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Echo AI chat"
              className="p-2 rounded-lg transition-colors duration-150 cursor-pointer hover:bg-[var(--bg-secondary)]"
              style={{ color: C.textSecondary }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Chat body: message list + input, explicit flex column so it can't collapse to 0px */}
        <div className="flex-1 flex flex-col w-full max-w-3xl mx-auto px-5 min-h-0">
          <div className="flex-1 overflow-y-auto py-6 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div
                  className="w-16 h-16 flex items-center justify-center mb-5 rounded-2xl border"
                  style={{ background: C.surface, borderColor: C.border, boxShadow: C.shadow }}
                >
                  <img src={echoIcon} alt="Echo" width={38} height={38} className="w-[38px] h-[38px]" style={{ mixBlendMode: 'multiply' }} />
                </div>
                <h3 className="text-xl font-semibold tracking-tight mb-1.5" style={{ color: C.text }}>Hey, I'm Echo</h3>
                <p className="text-sm mb-7 max-w-xs" style={{ color: C.textSecondary }}>
                  Ask me about your scans, vulnerabilities, or remediations.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setInput(suggestion)}
                      className="text-xs font-medium px-3.5 py-2 border rounded-full transition-all duration-200 hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] active:scale-[0.98]"
                      style={{ background: C.surface, borderColor: C.border, color: C.textSecondary }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`group flex items-start gap-2.5 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                  >
                    {m.role === 'assistant' ? (
                      <span
                        className="w-7 h-7 shrink-0 mt-0.5 rounded-lg border flex items-center justify-center"
                        style={{ background: C.surfaceHigh, borderColor: C.border }}
                      >
                        <img src={echoIcon} alt="Echo" width={17} height={17} className="w-[17px] h-[17px]" style={{ mixBlendMode: 'multiply' }} />
                      </span>
                    ) : (
                      <span
                        className="w-7 h-7 shrink-0 mt-0.5 rounded-lg flex items-center justify-center text-[11px] font-semibold"
                        style={{ background: C.primary, color: C.primaryText }}
                      >
                        {(user?.name?.[0] || 'U').toUpperCase()}
                      </span>
                    )}
                    <div className="flex flex-col gap-1 min-w-0">
                      <div
                        className={`px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user' ? 'rounded-2xl rounded-br-md whitespace-pre-wrap' : 'rounded-2xl rounded-bl-md'}`}
                        style={
                          m.role === 'user'
                            ? { background: C.primary, color: C.primaryText }
                            : { background: C.surface, color: C.text, border: `1px solid ${C.border}`, boxShadow: C.shadow }
                        }
                      >
                        {m.role === 'user' ? (
                          m.text
                        ) : (
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              ul: ({ children }) => <ul className="mb-2 last:mb-0 pl-4 space-y-1 list-disc">{children}</ul>,
                              ol: ({ children }) => <ol className="mb-2 last:mb-0 pl-4 space-y-1 list-decimal">{children}</ol>,
                              li: ({ children }) => <li>{children}</li>,
                              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                              a: ({ children, href }) => (
                                <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: C.primary }}>{children}</a>
                              ),
                              code: ({ children }) => (
                                <code className="px-1 py-0.5 rounded text-[12px]" style={{ background: C.surfaceHigh, fontFamily: C.mono }}>{children}</code>
                              ),
                              pre: ({ children }) => (
                                <pre className="mb-2 last:mb-0 p-3 rounded-lg overflow-x-auto text-[12px]" style={{ background: C.surfaceHigh, fontFamily: C.mono }}>{children}</pre>
                              ),
                            }}
                          >
                            {m.text}
                          </ReactMarkdown>
                        )}
                      </div>
                      <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
                        <button
                          type="button"
                          onClick={() => handleCopy(m.id, m.text)}
                          aria-label={m.role === 'assistant' ? 'Copy response' : 'Copy message'}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors hover:text-[var(--text-primary)]"
                          style={{ color: C.textMuted, fontFamily: C.mono }}
                        >
                          {copiedId === m.id ? <Check size={11} /> : <Copy size={11} />}
                          {copiedId === m.id ? 'Copied' : 'Copy'}
                        </button>
                        {m.role === 'user' && (
                          <button
                            type="button"
                            onClick={() => handleEditMessage(m)}
                            aria-label="Edit message"
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
                            style={{ color: C.textMuted, fontFamily: C.mono }}
                            disabled={isLoading}
                          >
                            <Pencil size={11} />
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="flex items-start gap-2.5 max-w-[85%] mr-auto">
                    <span
                      className="w-7 h-7 shrink-0 mt-0.5 rounded-lg border flex items-center justify-center"
                      style={{ background: C.surfaceHigh, borderColor: C.border }}
                    >
                      <img src={echoIcon} alt="Echo" width={17} height={17} className="w-[17px] h-[17px]" style={{ mixBlendMode: 'multiply' }} />
                    </span>
                    <div className="px-4 py-3 flex items-center gap-1 rounded-2xl rounded-bl-md" style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: C.shadow }}>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full animate-pulse"
                          style={{ background: C.textMuted, animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="flex items-end gap-2 border rounded-2xl p-2 mb-5 shrink-0 transition-all duration-200 focus-within:border-[var(--accent-primary)] focus-within:ring-1 focus-within:ring-[var(--accent-primary)]"
            style={{ background: C.surface, borderColor: C.border, boxShadow: C.shadow }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask Echo about your scans…"
              rows={1}
              className="flex-1 px-3 py-2 text-sm outline-none resize-none bg-transparent"
              style={{ color: C.text, maxHeight: 120 }}
            />
            <button
              type="submit"
              aria-label="Send message"
              className="p-2.5 rounded-xl transition-all duration-200 hover:brightness-110 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: C.primary, color: C.primaryText }}
              disabled={!input.trim() || isLoading}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AIChat;
