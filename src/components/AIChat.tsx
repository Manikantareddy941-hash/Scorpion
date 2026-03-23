import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Send, Minimize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '../contexts/ThemeContext';
import robotMascot from '../assets/tony-ai.png';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the SCORPION AI Architect. You are an expert in AWS, DevSecOps, and React. Your job is to: 1) Explain how to fix security vulnerabilities found in scans. 2) Provide code fixes for bugs. 3) Guide users on how to use SCORPION features like Governance, Reports, and The Sting.`;

const GREETINGS = [
  "Hey there!",
  "Hi!",
  "Hello!",
  "Hey!",
  "What’s up?",
  "How’s it going?"
];

export default function AIChat() {
  const { theme } = useTheme();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '🦂 SCORPION AI Architect initialized. How can I optimize your infrastructure today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Mascot State
  const [position, setPosition] = useState({ 
    x: Math.random() * (window.innerWidth - 100), 
    y: Math.random() * (window.innerHeight - 100) 
  });
  const [isDragging, setIsDragging] = useState(false);
  const [zIndex, setZIndex] = useState(999);
  const moveCounter = useRef(0);
  const [showHii, setShowHii] = useState(false);
  const [currentGreeting, setCurrentGreeting] = useState(GREETINGS[0]);
  const mascotSize = 60;

  // Context Awareness Interceptor
  useEffect(() => {
    const handleAIPrompt = (e: any) => {
      const detail = e.detail;
      if (detail && typeof detail === 'string') {
        setOpen(true);
        setMinimized(false);
        setInput(detail);
      }
    };
    window.addEventListener('ai_prompt', handleAIPrompt);
    return () => window.removeEventListener('ai_prompt', handleAIPrompt);
  }, []);

  // Finalized Movement & Logic Loop
  useEffect(() => {
    if (isDragging || open) return;

    const intervalId = setInterval(() => {
      // Pick new random positions every 4500ms
      const newX = Math.random() * (window.innerWidth - mascotSize);
      const newY = Math.random() * (window.innerHeight - mascotSize);
      setPosition({ x: newX, y: newY });

      // Every 4th move set z-index to 1 (behind cards), otherwise 999
      moveCounter.current += 1;
      if (moveCounter.current % 4 === 0) {
        setZIndex(1);
      } else {
        setZIndex(999);
      }

      // Periodically say "Hii!"
      if (Math.random() > 0.4) {
        const randomGreeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
        setCurrentGreeting(randomGreeting);
        setShowHii(true);
        setTimeout(() => setShowHii(false), 2500);
      }
    }, 4500);

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

  // Calculate dynamic chat window style
  const chatPanelWidth = 380;
  const chatPanelHeight = 500;
  const chatMargin = 20;

  const getChatPosition = () => {
    let left = position.x;
    let top = position.y;

    // Open next to mascot
    top = position.y - chatPanelHeight / 2;
    left = position.x - chatPanelWidth - chatMargin;
    
    // If too far left, open right
    if (left < chatMargin) {
      left = position.x + mascotSize + chatMargin;
    }

    // Viewport clamping
    const maxLeft = window.innerWidth - chatPanelWidth - chatMargin;
    const maxTop = window.innerHeight - (minimized ? 80 : chatPanelHeight) - chatMargin;

    left = Math.max(chatMargin, Math.min(left, maxLeft));
    top = Math.max(chatMargin, Math.min(top, maxTop));

    return { left, top };
  };

  const chatPos = getChatPosition();

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

  // Finalized mascot style
  const mascotStyle: any = {
    position: 'fixed',
    width: mascotSize,
    height: mascotSize,
    zIndex: zIndex,
    cursor: isDragging ? 'grabbing' : 'pointer',
    left: position.x,
    top: position.y,
    // Smooth transition
    transition: isDragging ? 'none' : 'all 2s ease-in-out',
    // Peeking effect when hiding (every 4th move)
    transform: zIndex === 1 ? 'translateY(40%)' : 'none'
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
        @keyframes waveHand {
          0%, 100% { transform: rotate(-20deg); }
          50% { transform: rotate(20deg); }
        }
        @keyframes bubblePop {
          0% { transform: scale(0) translateY(10px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
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
        .waving-arm {
          animation: waveHand 0.5s ease-in-out infinite;
          transform-origin: 30% 60%; /* Viewer's left shoulder */
          clip-path: inset(50% 65% 0 0); /* Isolate left arm (viewer's left) */
          position: absolute;
          inset: 0;
          z-index: 2;
        }
        .speech-bubble {
          animation: bubblePop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
          background: var(--accent-primary);
          color: var(--text-on-accent);
          padding: 4px 10px;
          border-radius: 8px 8px 8px 0;
          font-size: 10px;
          font-weight: 800;
          position: absolute;
          top: -25px;
          left: 70%;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          z-index: 1001;
        }
        .speech-bubble::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 0;
          border-left: 6px solid var(--accent-primary);
          border-bottom: 6px solid transparent;
        }
      `}</style>
      
      {!open && (
        <div
          onMouseDown={handleMouseDown}
          onClick={() => !isDragging && setOpen(true)}
          style={mascotStyle}
        >
          {showHii && <div className="speech-bubble">{currentGreeting} 👋</div>}
          <div 
            className="zero-gravity aura-glow" 
            style={{ 
              width: '100%', 
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}
          >
            {/* Main Static Body */}
            <img
              src={robotMascot}
              alt="Scorpio AI Mascot"
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'contain',
                filter: theme === 'dark' ? 'brightness(1.1)' : 'none'
              }}
            />
            {/* Waving Arm Overlay */}
            {showHii && (
              <img
                src={robotMascot}
                className="waving-arm"
                alt=""
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'contain',
                  filter: theme === 'dark' ? 'brightness(1.1)' : 'none'
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Chat window */}
      {open && (
        <div style={{ position: 'fixed', top: chatPos.top, left: chatPos.left, width: '380px', maxWidth: '95vw', background: 'var(--bg-card)', border: '1px solid var(--accent-primary)', borderRadius: '16px', zIndex: 1000, display: 'flex', flexDirection: 'column', boxShadow: '0 0 30px rgba(0,0,0,0.3)', transition: 'top 0.3s ease-out, left 0.3s ease-out' }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', borderRadius: '16px 16px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img
                src={robotMascot}
                alt="Scorpio AI Logo"
                style={{ width: '28px', height: '28px', objectFit: 'contain' }}
              />
              <div>
                <div style={{ color: 'var(--accent-primary)', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.1em' }}>SCORPIO AI</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Security Intelligence Assistant</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setMinimized(!minimized)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><Minimize2 size={16} /></button>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
            </div>
          </div>

          {!minimized && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', maxHeight: '380px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  placeholder="Ask SCORPIO AI..."
                  style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()}
                  style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer', opacity: loading || !input.trim() ? 0.4 : 1 }}>
                  <Send size={16} color="var(--text-on-accent)" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
