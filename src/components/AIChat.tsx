import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Copy, Check, RotateCcw } from 'lucide-react';
import echoIcon from '../assets/echo-ai.png';
import { useAuth } from '../contexts/AuthContext';

const ECHO_SYSTEM_PROMPT = "You are Echo, the AI assistant for the Scorpion DevSecOps platform. Answer the user's questions about their scans, vulnerabilities, and remediations concisely and accurately.";

const SUGGESTIONS = [
  'What are my critical findings?',
  "Summarize today's scan",
  'How do I fix the JWT secret issue?',
];

type AIChatProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

const AIChat: React.FC<AIChatProps> = ({ open, setOpen }) => {
  const { getJWT } = useAuth();
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
      const data = await res.json();
      const replyText = res.ok
        ? (data.reply || "I couldn't find anything for that.")
        : (data.error || 'Echo is unavailable right now.');
      setMessages((prev) => [...prev, { id: `${Date.now()}-reply`, role: 'assistant', text: replyText }]);
    } catch {
      setMessages((prev) => [...prev, { id: `${Date.now()}-reply`, role: 'assistant', text: 'Echo is unavailable right now — check your connection and try again.' }]);
    } finally {
      setIsLoading(false);
    }
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

  const handleClear = () => {
    setMessages([]);
    setInput('');
  };

  return (
    <div
      className={`fixed inset-0 ${open ? 'flex' : 'hidden'} flex-col z-50 p-4`}
      style={{ background: 'var(--bg-card)' }}
    >
      {/* TOP FEATURE BAR - AI CHAT INTERFACE */}
      <div className="w-full flex justify-between items-center border-b pb-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono animate-pulse" style={{ color: 'var(--severity-low)' }}>●</span>
          <h2 className="text-xs font-bold tracking-widest uppercase font-mono" style={{ color: 'var(--text-primary)' }}>
            ECHO AI ENGINE
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            disabled={messages.length === 0}
            aria-label="Clear conversation"
            title="Clear conversation"
            className="p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: 'var(--text-secondary)' }}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Echo AI chat"
            className="p-2 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
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
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--accent-primary)' }}>
                <img src={echoIcon} alt="Echo" className="w-9 h-9" />
              </div>
              <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Hey, I'm Echo</h3>
              <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                Ask me about your scans, vulnerabilities, or remediations.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="text-xs px-3 py-2 rounded-full border transition-colors"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
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
                    <img src={echoIcon} alt="Echo" className="w-6 h-6 rounded-full shrink-0 mt-0.5" />
                  ) : (
                    <span
                      className="w-6 h-6 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[11px] font-semibold"
                      style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
                    >
                      U
                    </span>
                  )}
                  <div className="flex flex-col gap-1 min-w-0">
                    <div
                      className="rounded-2xl px-4 py-2.5 text-sm"
                      style={
                        m.role === 'user'
                          ? { background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }
                          : { background: 'var(--bg-secondary)', color: 'var(--text-primary)' }
                      }
                    >
                      {m.text}
                    </div>
                    {m.role === 'assistant' && (
                      <button
                        type="button"
                        onClick={() => handleCopy(m.id, m.text)}
                        aria-label="Copy response"
                        className="self-start flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {copiedId === m.id ? <Check size={11} /> : <Copy size={11} />}
                        {copiedId === m.id ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-start gap-2 max-w-[85%] mr-auto">
                  <img src={echoIcon} alt="Echo" className="w-6 h-6 rounded-full shrink-0 mt-0.5" />
                  <div className="rounded-2xl px-4 py-3 flex items-center gap-1" style={{ background: 'var(--bg-secondary)' }}>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ background: 'var(--text-secondary)', animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <form onSubmit={handleSend} className="flex items-end gap-2 border-t pt-3 shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask Echo about your scans... (Shift+Enter for newline)"
            rows={1}
            className="flex-1 rounded-xl border bg-transparent px-4 py-2.5 text-sm outline-none resize-none"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', maxHeight: 120 }}
          />
          <button
            type="submit"
            aria-label="Send message"
            className="p-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
            disabled={!input.trim() || isLoading}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIChat;
