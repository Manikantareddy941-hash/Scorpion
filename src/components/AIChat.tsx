import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, X, Plus, MessageSquare, ChevronLeft, ChevronRight, Menu, Code, Image as ImageIcon, Video, Edit3, MonitorUp, ListTodo, MoreHorizontal, Camera, Star, Wand2, Shield, Wrench, BarChart2, Paperclip, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '../contexts/ThemeContext';
import robotMascot from '../assets/tony-ai.png';
import { databases, COLLECTIONS, DB_ID, Query } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';

import { useTranslation } from 'react-i18next';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are Echo, an expert in DevSecOps, cybersecurity, vulnerability scanning, Trivy, SCORPION platform features (scanning, reports, governance, remediation), cloud security (AWS, GCP, Azure), and general security best practices. Your answers must be confident, professional, and concise.

CRITICAL INSTRUCTIONS:
- When the user says hi, hello, hey or any greeting, respond with a time-appropriate greeting — use 'Good morning' if it's before 12pm, 'Good afternoon' if between 12pm-5pm, 'Good evening' if after 5pm — followed by a short friendly message. Do NOT repeat your introduction every time.
- For greetings, respond with only 2-3 lines. Keep it friendly and brief.
- Example greeting response: "Good morning! I'm Echo — what can I help you with today?"
- Do NOT list features or capabilities unless the user explicitly asks.
- Never use numbered bullet points in simple greetings.`;

interface AIChatProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function AIChat({ open, setOpen }: AIChatProps) {
  const { t } = useTranslation();
  const { theme, echoMovementEnabled } = useTheme();
  const location = useLocation();

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: t('aichat.welcome_message', "Hi! I'm Echo 👋 Your DevSecOps AI assistant. Ask me anything about security scanning, vulnerabilities, or how to use SCORPION.") }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resizable Panel State
  const [panelWidth, setPanelWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);

  const { user } = useAuth();
  const [currentSessionId, setCurrentSessionId] = useState(() => crypto.randomUUID());
  const [sessions, setSessions] = useState<any[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const loadSessions = async () => {
    if (!user?.$id) return;
    try {
      console.log('Loading sessions for user:', user.$id, 'Collection:', COLLECTIONS.CHAT_SESSIONS);
      const res = await databases.listDocuments(DB_ID, COLLECTIONS.CHAT_SESSIONS, [
        Query.equal('userId', user.$id),
        Query.orderDesc('createdAt'),
        Query.limit(20)
      ]);
      console.log('Loaded sessions:', res.documents);
      setSessions(res.documents);
    } catch (e) {
      console.error('Failed to load sessions', e);
    }
  };

  const handleSessionClick = (session: any) => {
    try {
      const parsed = JSON.parse(session.messages);
      setMessages(parsed);
      setCurrentSessionId(session.sessionId);
    } catch (e) {
      console.error('Failed to parse session messages', e);
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(crypto.randomUUID());
    setMessages([{ role: 'assistant', content: t('aichat.welcome_message', "Hi! I'm Echo 👋 Your DevSecOps AI assistant. Ask me anything about security scanning, vulnerabilities, or how to use SCORPION.") }]);
  };

  // Mascot State
  const [position, setPosition] = useState({
    x: Math.random() * (window.innerWidth - 100),
    y: Math.random() * (window.innerHeight - 100)
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const [zIndex, setZIndex] = useState(999);
  const moveCounter = useRef(0);

  const mascotSize = 60;

  // Context Awareness Interceptor
  useEffect(() => {
    const handleAIPrompt = (e: any) => {
      const detail = e.detail;
      if (detail && typeof detail === 'string') {
        setOpen(true);
        setInput(detail);
      }
    };
    window.addEventListener('ai_prompt', handleAIPrompt);
    return () => window.removeEventListener('ai_prompt', handleAIPrompt);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      loadSessions();
    }
  }, [open, user?.$id]);

  // Movement Logic
  useEffect(() => {
    if (isDragging || open || !echoMovementEnabled) return;

    const intervalId = setInterval(() => {
      const newX = Math.random() * (window.innerWidth - mascotSize);
      const newY = Math.random() * (window.innerHeight - mascotSize);
      setPosition({ x: newX, y: newY });

      moveCounter.current += 1;
      if (moveCounter.current % 4 === 0) {
        setZIndex(1);
      } else {
        setZIndex(999);
      }
    }, 12000); // Slower movement

    return () => clearInterval(intervalId);
  }, [isDragging, open]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (open) return;
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    hasMoved.current = false;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved.current = true;
      }
      setPosition({
        x: e.clientX - mascotSize / 2,
        y: e.clientY - mascotSize / 2
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 320 && newWidth <= 700) {
        setPanelWidth(newWidth);
      } else if (newWidth < 320) {
        setPanelWidth(320);
      } else if (newWidth > 700) {
        setPanelWidth(700);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');

    const newMessages = [...messages, { role: 'user' as const, content: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const isFirstMessage = messages.filter(m => m.role === 'user').length === 0;
      const messagesString = JSON.stringify(newMessages);

      if (isFirstMessage) {
        await databases.createDocument(
          DB_ID,
          COLLECTIONS.CHAT_SESSIONS,
          currentSessionId,
          {
            sessionId: currentSessionId,
            title: userMsg.substring(0, 40) + (userMsg.length > 40 ? '...' : ''),
            messages: messagesString,
            userId: user?.$id || 'anonymous',
            createdAt: new Date().toISOString()
          }
        );
        loadSessions();
      } else {
        await databases.updateDocument(
          DB_ID,
          COLLECTIONS.CHAT_SESSIONS,
          currentSessionId,
          { messages: messagesString }
        );
      }
    } catch (e) {
      console.error('Failed to save user msg to Appwrite', e);
    }

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined') {
        setMessages(prev => [...prev, { role: 'assistant', content: t('aichat.missing_api_key', '⚠️ Missing API Key. Please add VITE_GEMINI_API_KEY to your .env file.') }]);
        setLoading(false);
        return;
      }

      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const firstUserIndex = messages.findIndex(m => m.role === 'user');
      const validHistory = firstUserIndex === -1 ? [] : messages.slice(firstUserIndex);

      const geminiHistory = validHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const context = location.pathname.includes('/reports')
        ? t('aichat.system_note_reports', " [SYSTEM NOTE: The user is currently viewing the Reports page. Analyze latest scan contextual data if requested.]")
        : location.pathname.includes('/governance')
          ? t('aichat.system_note_governance', " [SYSTEM NOTE: The user is currently on the Governance page managing infrastructure policies.]")
          : "";

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: `[CURRENT_TIME: ${new Date().toLocaleTimeString()}] ` + SYSTEM_PROMPT + context }],
          },
          contents: [
            ...geminiHistory,
            { role: 'user', parts: [{ text: userMsg }] },
          ],
          generationConfig: {
            maxOutputTokens: 1000,
          },
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error(`Gemini API Error (${response.status}):`, errBody);
        throw new Error(`API error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || t('aichat.no_response', 'No response received.');

      const finalMessages = [...newMessages, { role: 'assistant' as const, content: reply.trim() }];
      setMessages(finalMessages);

      try {
        await databases.updateDocument(
          DB_ID,
          COLLECTIONS.CHAT_SESSIONS,
          currentSessionId,
          { messages: JSON.stringify(finalMessages) }
        );
      } catch (e) {
        console.error('Failed to update session with AI reply', e);
      }
    } catch (err: any) {
      console.error('Neural Link Disconnection:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: t('aichat.neural_link_disconnected', { error: err.message, defaultValue: `⚠️ Neural Link Disconnected. ${err.message}` }) }]);
    } finally {
      setLoading(false);
    }
  };

  const mascotStyle: any = {
    position: 'fixed',
    width: mascotSize,
    height: mascotSize,
    zIndex: zIndex,
    cursor: isDragging ? 'grabbing' : 'pointer',
    left: position.x,
    top: position.y,
    transition: isDragging || !echoMovementEnabled ? 'none' : 'all 3.5s ease-in-out',
    transform: zIndex === 1 ? 'translateY(40%)' : 'none',
    animation: !echoMovementEnabled ? 'none !important' : undefined
  };

  const chatPanelStyle: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: open ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.95)',
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    width: '95%',
    maxWidth: '900px',
    height: '620px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '16px',
    boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
    zIndex: 1002,
    display: 'flex',
    flexDirection: 'row',
    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    overflow: 'hidden',
    fontFamily: '"Inter", "DM Sans", sans-serif'
  };

  return (
    <>
      <style>{`
        @keyframes highQualityFloat {
          0% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(4px, -15px) rotate(1deg); }
          50% { transform: translate(-4px, -25px) rotate(-1deg); }
          75% { transform: translate(3px, -15px) rotate(1deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes premiumGlow {
          0% { filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.4)) drop-shadow(0 0 30px rgba(0, 255, 255, 0.2)); }
          50% { filter: drop-shadow(0 0 25px rgba(0, 255, 255, 0.7)) drop-shadow(0 0 50px rgba(0, 255, 255, 0.4)); }
          100% { filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.4)) drop-shadow(0 0 30px rgba(0, 255, 255, 0.2)); }
        }
        @keyframes messageFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 20px color-mix(in srgb, var(--accent-primary) 40%, transparent); transform: scale(1); }
          50% { box-shadow: 0 0 60px color-mix(in srgb, var(--accent-primary) 90%, transparent); transform: scale(1.02); }
          100% { box-shadow: 0 0 20px color-mix(in srgb, var(--accent-primary) 40%, transparent); transform: scale(1); }
        }
        .zero-gravity {
          animation: highQualityFloat 8s ease-in-out infinite;
          transform-style: preserve-3d;
          will-change: transform;
        }
        .aura-glow {
          animation: premiumGlow 4s ease-in-out infinite;
          will-change: filter;
        }
        .chip-hover {
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .chip-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .input-card-focus {
          border: 1.5px solid var(--border-subtle);
          transition: all 0.2s ease;
        }
        .input-card-focus:focus-within {
          border: 1.5px solid transparent;
          background: linear-gradient(var(--bg-primary), var(--bg-primary)) padding-box, linear-gradient(to right, var(--accent-primary), var(--accent-secondary)) border-box;
        }
      `}</style>

      {!open && (
        <div
          onMouseDown={handleMouseDown}
          onClick={() => {
            if (!hasMoved.current) {
              setOpen(true);
            }
          }}
          style={mascotStyle}
        >
          <div
            className={`${echoMovementEnabled ? 'zero-gravity aura-glow' : ''}`}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              animation: !echoMovementEnabled ? 'none !important' : undefined
            }}
          >
            <img
              src={robotMascot}
              alt="Echo Mascot"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: theme === 'dark' ? 'brightness(1.1)' : 'none',
                animation: !echoMovementEnabled ? 'none !important' : undefined
              }}
            />
          </div>
        </div>
      )}

      <div style={chatPanelStyle}>
        {/* Sessions Sidebar (Left Panel) */}
        <div style={{
          width: '280px',
          minWidth: '280px',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)', // implicitly #111111 in dark theme
          borderRadius: '16px 0 0 16px',
          zIndex: 2
        }}>
          {/* Top Actions */}
          <div style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleNewChat} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '6px', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="hover:bg-[var(--accent-primary)] transition-colors"><Edit3 size={16} /></button>
              <button style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '6px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="hover:text-[var(--text-primary)] transition-colors"><ListTodo size={16} /></button>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }} className="hover:text-[var(--text-primary)] transition-colors"><X size={18} /></button>
          </div>


          {/* History List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }} className="custom-scrollbar">
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '8px', paddingLeft: '4px' }}>Today</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sessions.slice(0, 3).map((s, idx) => (
                  <button key={s.$id || idx} title={s.title} onClick={() => handleSessionClick(s)} style={{ width: '100%', padding: '12px', textAlign: 'left', background: currentSessionId === s.sessionId ? 'var(--bg-card)' : 'transparent', border: currentSessionId === s.sessionId ? '1px solid var(--border-subtle)' : '1px solid transparent', borderRadius: '12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-primary)' }} className="hover:bg-[var(--bg-card)] transition-colors">
                    <div style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                      {s.title.length > 25 ? s.title.substring(0, 25) + '...' : s.title}
                    </div>
                    <MoreHorizontal size={14} color="var(--text-secondary)" />
                  </button>
                ))}
                {sessions.length === 0 && (
                  <button style={{ width: '100%', padding: '12px', textAlign: 'left', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-primary)' }}>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>Initial Context</div>
                    <MoreHorizontal size={14} color="var(--text-secondary)" />
                  </button>
                )}
              </div>
            </div>
            
            {sessions.length > 3 && (
              <div>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '8px', paddingLeft: '4px' }}>Previous</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {sessions.slice(3).map((s, idx) => (
                    <button key={s.$id || idx} title={s.title} onClick={() => handleSessionClick(s)} style={{ width: '100%', padding: '12px', textAlign: 'left', background: 'transparent', border: '1px solid transparent', borderRadius: '12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-secondary)' }} className="hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition-colors">
                      <div style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {s.title.length > 25 ? s.title.substring(0, 25) + '...' : s.title}
                      </div>
                      <MoreHorizontal size={14} color="inherit" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Upsell/Feature Card */}
          <div style={{ padding: '20px' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', borderRadius: '14px', padding: '16px', color: 'var(--text-on-accent)', position: 'relative', overflow: 'hidden', cursor: 'pointer' }} className="hover:opacity-90 transition-opacity">
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px', position: 'relative', zIndex: 1 }}>Scorpion Pro</div>
              <div style={{ fontSize: '12px', opacity: 0.9, position: 'relative', zIndex: 1 }}>Unlock advanced agent workflows</div>
              <div style={{ position: 'absolute', right: '16px', bottom: '16px', zIndex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ChevronRight size={14} />
              </div>
              <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '80px', height: '80px', background: 'rgba(255,255,255,0.1)', borderRadius: '50%' }} />
            </div>
          </div>
        </div>

        {/* Main Chat Panel (Right Panel) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', background: 'var(--bg-primary)' }}>
          {/* Subtle Radial Glow */}
          <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -50%)', width: '600px', height: '600px', background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-primary) 8%, transparent) 0%, transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />

          {/* Top Bar */}
          <div style={{ padding: '20px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={robotMascot} alt="Echo Logo" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
              <div style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '15px', letterSpacing: '0.02em' }}>ECHO</div>
            </div>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              <User size={16} />
            </div>
          </div>

          {messages.length <= 1 ? (
            /* Welcome State */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px', position: 'relative', zIndex: 1 }}>
              <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', marginBottom: '24px', animation: 'pulseGlow 3s infinite ease-in-out' }} />
              <h2 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px', textAlign: 'center' }}>Welcome back, {user?.name?.split(' ')[0] || 'Operator'}!</h2>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '48px', textAlign: 'center' }}>Echo is online. Ask me anything about your SCORPION environment.</p>

              {/* 3 Feature Cards */}
              <div style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '700px' }}>
                <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="hover:border-[var(--accent-primary)] transition-colors" onClick={() => setInput("Explain my latest vulnerability scan results in plain language.")}>
                  <Shield size={20} color="var(--accent-primary)" style={{ marginBottom: '12px' }} />
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '6px' }}>Scan Analysis</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>I'll explain your vulnerability scan results in plain language</div>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="hover:border-[var(--accent-primary)] transition-colors" onClick={() => setInput("How do I fix the latest critical CVEs?")}>
                  <Wrench size={20} color="var(--accent-primary)" style={{ marginBottom: '12px' }} />
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '6px' }}>Security Guidance</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Ask me how to fix any CVE or security issue found</div>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: '14px', padding: '20px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="hover:border-[var(--accent-primary)] transition-colors" onClick={() => setInput("Give me an instant risk report across my repositories.")}>
                  <BarChart2 size={20} color="var(--accent-primary)" style={{ marginBottom: '12px' }} />
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '6px' }}>Risk Summary</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>Get an instant risk report across your repositories</div>
                </div>
              </div>
            </div>
          ) : (
            /* Active Chat Messages */
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 40px', display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative', zIndex: 1 }} className="custom-scrollbar">
              {messages.filter(msg => msg.role !== 'assistant' || msg.content !== t('aichat.welcome_message', "Hi! I'm Echo 👋 Your DevSecOps AI assistant. Ask me anything about security scanning, vulnerabilities, or how to use SCORPION.")).map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start' }}>
                  {msg.role === 'assistant' && (
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '16px', flexShrink: 0, border: '1px solid var(--border-subtle)' }}>
                      <img src={robotMascot} alt="Echo" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                    </div>
                  )}
                  <div style={{
                    maxWidth: '80%', padding: '16px 20px', borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? 'var(--text-primary)' : 'transparent',
                    color: msg.role === 'user' ? 'var(--bg-primary)' : 'var(--text-primary)', fontSize: '15px', lineHeight: '1.6',
                    overflowX: 'auto', border: msg.role === 'assistant' ? 'none' : 'none'
                  }}>
                    <div className={`markdown-body ${msg.role === 'user' ? 'text-[var(--text-on-accent)]' : ''}`}>
                      <ReactMarkdown
                        components={{
                          pre: ({ node, ...props }: any) => <pre style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', overflowX: 'auto', margin: '12px 0', border: '1px solid var(--border-subtle)' }} {...props} />,
                          code: ({ node, inline, className, ...props }: any) => {
                            return inline ? <code style={{ background: 'var(--bg-card)', padding: '2px 6px', borderRadius: '6px', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }} {...props} /> : <code style={{ color: 'var(--text-primary)', fontSize: '13px' }} className={className} {...props} />
                          },
                          p: ({ node, ...props }: any) => <p style={{ margin: '0 0 12px 0' }} {...props} />,
                          ul: ({ node, ...props }: any) => <ul style={{ margin: '0 0 12px 0', paddingLeft: '24px', listStyleType: 'disc' }} {...props} />
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', gap: '4px', padding: '16px 20px', marginLeft: '48px', width: 'fit-content' }}>
                  {[0, 1, 2].map(i => <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--text-secondary)', animation: 'bounce 1s infinite', animationDelay: `${i * 0.2}s` }} />)}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input Bar */}
          <div style={{ padding: '0 40px 32px', position: 'relative', zIndex: 1 }}>
            <div style={{ 
              width: '100%', 
              borderRadius: '16px', 
              background: 'var(--bg-card)', 
              display: 'flex', 
              alignItems: 'center', 
              padding: '12px 16px',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
            }}>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '8px' }} className="hover:text-[var(--text-primary)] transition-colors">
                <Paperclip size={20} strokeWidth={1.5} />
              </button>
              
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '999px', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '6px', marginRight: '16px' }}>
                <img src={robotMascot} alt="Echo" style={{ width: '12px', height: '12px' }} />
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>Powered by Echo</span>
              </div>

              <input 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask Echo anything about Scorpion..."
                style={{ 
                  flex: 1, 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-primary)', 
                  fontSize: '15px', 
                  outline: 'none',
                  fontWeight: 400
                }}
              />

              <button 
                onClick={sendMessage} 
                disabled={loading || !input.trim()} 
                style={{ 
                  background: 'var(--accent-primary)', 
                  color: 'var(--text-on-accent)', 
                  border: 'none', 
                  borderRadius: '50%', 
                  width: '36px', 
                  height: '36px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  cursor: 'pointer', 
                  opacity: loading || !input.trim() ? 0.5 : 1, 
                  marginLeft: '12px' 
                }} 
                className="hover:opacity-90 transition-opacity"
              >
                <Send size={16} style={{ marginLeft: '-2px' }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
