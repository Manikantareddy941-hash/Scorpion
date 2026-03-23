import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '../contexts/ThemeContext';
import robotMascot from '../assets/tony-ai.png';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the SCORPION AI Architect. You are an expert in AWS, DevSecOps, and React. Your job is to: 1) Explain how to fix security vulnerabilities found in scans. 2) Provide code fixes for bugs. 3) Guide users on how to use SCORPION features like Governance, Reports, and The Sting.`;

interface AIChatProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function AIChat({ open, setOpen }: AIChatProps) {
  const { theme } = useTheme();
  const location = useLocation();

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I\'m Echo, your AI assistant. How can I help you?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resizable Panel State
  const [panelWidth, setPanelWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  
  // Mascot State
  const [position, setPosition] = useState({ 
    x: Math.random() * (window.innerWidth - 100), 
    y: Math.random() * (window.innerHeight - 100) 
  });
  const [isDragging, setIsDragging] = useState(false);
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

  // Movement Logic
  useEffect(() => {
    if (isDragging || open) return;

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
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
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
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined') {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Missing API Key. Please add VITE_GEMINI_API_KEY to your .env file.' }]);
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
        ? " [SYSTEM NOTE: The user is currently viewing the Reports page. Analyze latest scan contextual data if requested.]" 
        : location.pathname.includes('/governance') 
        ? " [SYSTEM NOTE: The user is currently on the Governance page managing infrastructure policies.]" 
        : "";

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT + context }],
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
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';

      setMessages(prev => [...prev, { role: 'assistant', content: reply.trim() }]);
    } catch (err: any) {
      console.error('Neural Link Disconnection:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Neural Link Disconnected. ${err.message}` }]);
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
    transition: isDragging ? 'none' : 'all 3.5s ease-in-out',
    transform: zIndex === 1 ? 'translateY(40%)' : 'none'
  };

  const chatPanelStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    right: open ? 0 : `-${panelWidth}px`,
    width: `${panelWidth}px`,
    height: '100vh',
    background: 'var(--bg-secondary)',
    borderLeft: '1px solid var(--border-subtle)',
    zIndex: 1002,
    display: 'flex',
    flexDirection: 'column',
    transition: isResizing ? 'none' : 'right 0.3s ease-in-out'
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
        .zero-gravity {
          animation: highQualityFloat 8s ease-in-out infinite;
          transform-style: preserve-3d;
          will-change: transform;
        }
        .aura-glow {
          animation: premiumGlow 4s ease-in-out infinite;
          will-change: filter;
        }
      `}</style>
      
      {!open && (
        <div
          onMouseDown={handleMouseDown}
          onClick={() => !isDragging && setOpen(true)}
          style={mascotStyle}
        >
          <div className="zero-gravity aura-glow" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <img src={robotMascot} alt="Echo Mascot" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: theme === 'dark' ? 'brightness(1.1)' : 'none' }} />
          </div>
        </div>
      )}

      <div style={chatPanelStyle}>
        {/* Resize Handle */}
        <div 
          onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
          style={{
            position: 'absolute',
            left: '-4px',
            top: 0,
            bottom: 0,
            width: '8px',
            cursor: 'ew-resize',
            zIndex: 10,
            display: 'flex',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => {
            const inner = e.currentTarget.firstChild as HTMLElement;
            if (inner) inner.style.backgroundColor = 'var(--accent-primary)';
          }}
          onMouseLeave={(e) => {
            const inner = e.currentTarget.firstChild as HTMLElement;
            if (inner && !isResizing) inner.style.backgroundColor = 'transparent';
          }}
        >
          <div style={{
            width: '2px',
            height: '100%',
            backgroundColor: isResizing ? 'var(--accent-primary)' : 'transparent',
            transition: 'background-color 0.2s'
          }} />
        </div>

        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={robotMascot} alt="Echo Logo" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
            <div>
              <div style={{ color: 'var(--accent-primary)', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.1em' }}>ECHO</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Security Intelligence Assistant</div>
            </div>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '12px 16px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-primary)',
                color: msg.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-primary)', fontSize: '0.85rem', lineHeight: '1.6',
                overflowX: 'auto', border: msg.role === 'assistant' ? '1px solid var(--border-subtle)' : 'none'
              }}>
                <div className={`markdown-body ${msg.role === 'user' ? 'text-[var(--text-on-accent)]' : ''}`}>
                  <ReactMarkdown 
                    components={{
                      pre: ({node, ...props}: any) => <pre style={{ background: '#0B1121', padding: '12px', borderRadius: '8px', overflowX: 'auto', margin: '8px 0', border: '1px solid #1e293b' }} {...props} />,
                      code: ({node, inline, className, ...props}: any) => {
                          return inline ? <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 4px', borderRadius: '4px', color: '#38bdf8' }} {...props} /> : <code style={{ color: '#e2e8f0', fontSize: '0.8rem' }} className={className} {...props} />
                      },
                      p: ({node, ...props}: any) => <p style={{ margin: '0 0 8px 0' }} {...props} />,
                      ul: ({node, ...props}: any) => <ul style={{ margin: '0 0 8px 0', paddingLeft: '20px', listStyleType: 'disc' }} {...props} />
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', gap: '4px', padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: '12px', width: 'fit-content' }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-primary)', animation: 'bounce 1s infinite', animationDelay: `${i * 0.2}s` }} />)}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '8px' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask Echo..."
            style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}
            style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer', opacity: loading || !input.trim() ? 0.4 : 1 }}>
            <Send size={16} color="var(--text-on-accent)" />
          </button>
        </div>
      </div>
    </>
  );
}
