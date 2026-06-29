import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Copy, Check, Plus, MessageSquare, Trash2 } from 'lucide-react';
import echoIcon from '../assets/echo-ai.webp';
import { useAuth } from '../contexts/AuthContext';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

const ECHO_SYSTEM_PROMPT = "You are Echo, the AI assistant for the Scorpion DevSecOps platform. Answer the user's questions about their scans, vulnerabilities, and remediations concisely and accurately.";

const SUGGESTIONS = [
  'What are my critical findings?',
  "Summarize today's scan",
  'How do I fix the JWT secret issue?',
];

// "Sentinel" command-center skin — dark navy/blue, Inter + JetBrains Mono.
const C = {
  bg: '#131313',
  surface: '#1c1b1b',
  surfaceHigh: '#2a2a2a',
  border: '#2D3748',
  text: '#e5e2e1',
  textMuted: '#8b919c',
  primary: '#3182ce',
  primaryText: '#ffffff',
  success: '#38a169',
  body: "'Inter', sans-serif",
  mono: "'JetBrains Mono', monospace",
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

const AIChat: React.FC<AIChatProps> = ({ open, setOpen }) => {
  const { getJWT, user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    if (!open || !user) return;
    databases.listDocuments(DB_ID, COLLECTIONS.CHAT_SESSIONS, [
      Query.equal('user_id', user.$id),
      Query.orderDesc('$updatedAt'),
      Query.limit(30),
    ]).then((res) => {
      setSessions(res.documents.map((d: any) => ({
        id: d.$id,
        title: d.title || 'Untitled chat',
        messages: (() => { try { return JSON.parse(d.messages || '[]'); } catch { return []; } })(),
      })));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const persistSession = async (history: ChatMessage[], sessionId: string | null) => {
    if (!user) return sessionId;
    const payload = { user_id: user.$id, title: titleFromMessage(history[0]?.text || 'Untitled chat'), messages: JSON.stringify(history) };
    try {
      if (sessionId) {
        await databases.updateDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, sessionId, { messages: payload.messages });
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, messages: history } : s)));
        return sessionId;
      }
      const doc = await databases.createDocument(DB_ID, COLLECTIONS.CHAT_SESSIONS, ID.unique(), payload);
      setSessions((prev) => [{ id: doc.$id, title: payload.title, messages: history }, ...prev]);
      return doc.$id;
    } catch {
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
          const events = buffer.split('\n\n');
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

  return (
    <div
      className={`fixed inset-0 ${open ? 'flex' : 'hidden'} z-50`}
      style={{ background: C.bg, fontFamily: C.body }}
    >
      {/* Sidebar: new chat + history */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r p-3" style={{ borderColor: C.border, background: C.surface }}>
        <button
          type="button"
          onClick={handleNewChat}
          className="flex items-center justify-center gap-2 px-3 py-2.5 mb-4 text-xs font-bold uppercase tracking-widest transition-colors"
          style={{ background: C.primary, color: C.primaryText, borderRadius: 4 }}
        >
          <Plus size={14} /> New chat
        </button>
        <p className="text-[10px] font-semibold tracking-widest uppercase mb-2 px-1" style={{ color: C.textMuted, fontFamily: C.mono }}>Recents</p>
        <div className="flex-1 overflow-y-auto space-y-1">
          {sessions.length === 0 ? (
            <p className="text-xs px-1" style={{ color: C.textMuted }}>No conversations yet.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSession(s)}
                className="group w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors"
                style={{
                  background: activeSessionId === s.id ? C.surfaceHigh : 'transparent',
                  color: C.text,
                  borderRadius: 4,
                }}
              >
                <MessageSquare size={13} className="shrink-0" style={{ color: C.textMuted }} />
                <span className="flex-1 truncate">{s.title}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => handleDeleteSession(e, s.id)}
                  aria-label="Delete conversation"
                  className="opacity-0 group-hover:opacity-100 p-1 transition-opacity"
                  style={{ color: C.textMuted }}
                >
                  <Trash2 size={12} />
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col p-4 min-w-0">
        {/* TOP FEATURE BAR - AI CHAT INTERFACE */}
        <div className="w-full flex justify-between items-center border-b pb-4" style={{ borderColor: C.border }}>
          <div
            className="flex items-center gap-2 px-2.5 py-1"
            style={{ background: `color-mix(in srgb, ${C.primary} 15%, transparent)`, border: `1px solid ${C.primary}`, borderRadius: 4 }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: C.success }} />
            <h2 className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: C.text, fontFamily: C.mono }}>
              ECHO AI ENGINE
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleNewChat}
              aria-label="New chat"
              title="New chat"
              className="md:hidden p-2 transition-colors"
              style={{ color: C.textMuted }}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Echo AI chat"
              className="p-2 transition-colors cursor-pointer"
              style={{ color: C.textMuted }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {/* Chat body: message list + input, explicit flex column so it can't collapse to 0px */}
        <div className="flex-1 flex flex-col w-full" style={{ minHeight: 480 }}>
          <div className="flex-1 overflow-y-auto px-1 py-4 space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="w-14 h-14 flex items-center justify-center mb-4" style={{ background: C.primary, borderRadius: 4 }}>
                  <img src={echoIcon} alt="Echo" width={36} height={36} className="w-9 h-9" style={{ mixBlendMode: 'multiply' }} />
                </div>
                <h3 className="text-lg font-semibold mb-1" style={{ color: C.text }}>Hey, I'm Echo</h3>
                <p className="text-sm mb-6" style={{ color: C.textMuted }}>
                  Ask me about your scans, vulnerabilities, or remediations.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setInput(suggestion)}
                      className="text-xs px-3 py-2 border transition-colors"
                      style={{ borderColor: C.border, color: C.textMuted, borderRadius: 4 }}
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
                    className={`group flex items-start gap-2 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                  >
                    {m.role === 'assistant' ? (
                      <img src={echoIcon} alt="Echo" width={24} height={24} className="w-6 h-6 shrink-0 mt-0.5 rounded-full" style={{ mixBlendMode: 'multiply' }} />
                    ) : (
                      <span
                        className="w-6 h-6 shrink-0 mt-0.5 rounded-full flex items-center justify-center text-[11px] font-semibold"
                        style={{ background: C.primary, color: C.primaryText }}
                      >
                        U
                      </span>
                    )}
                    <div className="flex flex-col gap-1 min-w-0">
                      <div
                        className="px-4 py-2.5 text-sm"
                        style={
                          m.role === 'user'
                            ? { background: C.primary, color: C.primaryText, borderRadius: 4 }
                            : { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4 }
                        }
                      >
                        {m.text}
                      </div>
                      {m.role === 'assistant' && (
                        <button
                          type="button"
                          onClick={() => handleCopy(m.id, m.text)}
                          aria-label="Copy response"
                          className="self-start flex items-center gap-1 px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: C.textMuted, fontFamily: C.mono }}
                        >
                          {copiedId === m.id ? <Check size={11} /> : <Copy size={11} />}
                          {copiedId === m.id ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="flex items-start gap-2 max-w-[85%] mr-auto">
                    <img src={echoIcon} alt="Echo" width={24} height={24} className="w-6 h-6 shrink-0 mt-0.5 rounded-full" style={{ mixBlendMode: 'multiply' }} />
                    <div className="px-4 py-3 flex items-center gap-1" style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4 }}>
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

          <form onSubmit={handleSend} className="flex items-end gap-2 border-t pt-3 shrink-0" style={{ borderColor: C.border }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask Echo about your scans... (Shift+Enter for newline)"
              rows={1}
              className="flex-1 border px-4 py-2.5 text-sm outline-none resize-none"
              style={{ background: '#0e0e0e', borderColor: C.border, color: C.text, borderRadius: 4, maxHeight: 120 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = C.primary; e.currentTarget.style.boxShadow = `0 0 0 1px ${C.primary}`; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <button
              type="submit"
              aria-label="Send message"
              className="p-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: C.primary, color: C.primaryText, borderRadius: 4 }}
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
