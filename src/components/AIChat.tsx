import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Send, Minimize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '../contexts/ThemeContext';
import robotMascot from '../assets/robot-mascot.png';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the SCORPION AI Architect. You are an expert in AWS, DevSecOps, and React. Your job is to: 1) Explain how to fix security vulnerabilities found in scans. 2) Provide code fixes for bugs. 3) Guide users on how to use SCORPION features like Governance, Reports, and The Sting.`;

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
  const mascotSize = 80;

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
      // Pick new random positions every 3500ms
      const newX = Math.random() * (window.innerWidth - 100);
      const newY = Math.random() * (window.innerHeight - 100);
      setPosition({ x: newX, y: newY });

      // Every 4th move set z-index to 1 (behind cards), otherwise 999
      moveCounter.current += 1;
      if (moveCounter.current % 4 === 0) {
        setZIndex(1);
      } else {
        setZIndex(999);
      }
    }, 3500);

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
      const apiKey = import.meta.env.VITE_HUGGINGFACE_API_KEY;
      if (!apiKey || apiKey === 'undefined') {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Missing API Key. Please add VITE_HUGGINGFACE_API_KEY to your .env file.' }]);
        setLoading(false);
        return;
      }
      
      const hfEndpoint = `https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2`;

      const firstUserIndex = messages.findIndex(m => m.role === 'user');
      const validHistory = firstUserIndex === -1 ? [] : messages.slice(firstUserIndex);

      let context = location.pathname.includes('/reports') 
        ? " [SYSTEM NOTE: The user is currently viewing the Reports page. Analyze latest scan contextual data if requested.]" 
        : location.pathname.includes('/governance') 
        ? " [SYSTEM NOTE: The user is currently on the Governance page managing infrastructure policies.]" 
        : "";

      let formattedPrompt = `<s>[INST] ${SYSTEM_PROMPT}${context}\n\n`;
      validHistory.forEach(msg => {
          if (msg.role === 'user') formattedPrompt += `User: ${msg.content} [/INST]`;
          else formattedPrompt += `\nAssistant: ${msg.content} </s><s>[INST] `;
      });
      formattedPrompt += `User: ${userMsg} [/INST]`;

      let attempts = 0;
      let reply = 'No response received.';

      while (attempts < 2) {
        try {
          const response = await fetch(hfEndpoint, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              inputs: formattedPrompt,
              parameters: { max_new_tokens: 1000, return_full_text: false }
            }),
          });

          if (!response.ok) {
            const errBody = await response.text();
            console.error(`HF API Error (${response.status}):`, errBody);
            
            // Handle 503 Model Loading Error explicitly
            if (response.status === 503 && attempts === 0) {
              console.log('Model is loading... retrying in 5 seconds.');
              await new Promise(r => setTimeout(r, 5000));
              attempts++;
              continue;
            }
            throw new Error(`API error ${response.status}: ${errBody}`);
          }
          
          const data = await response.json();
          reply = data[0]?.generated_text || 'No response received.';
          break; // success
        } catch (fetchErr: any) {
          if (attempts === 1) throw fetchErr;
          console.error('Fetch error:', fetchErr);
          await new Promise(r => setTimeout(r, 5000));
          attempts++;
        }
      }

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
    transition: isDragging ? 'none' : 'all 1.5s ease-in-out',
    // Peeking effect when hiding (every 4th move)
    transform: zIndex === 1 ? 'translateY(40%)' : 'none'
  };

  return (
    <>
      <style>{`
        @keyframes spin3d {
          from { transform: rotateY(0deg); }
          to { transform: rotateY(360deg); }
        }
        @keyframes float {
          from { transform: translateY(0px); }
          to { transform: translateY(-12px); }
        }
        @keyframes glowPulse {
          from { filter: drop-shadow(0 0 8px cyan); }
          to { filter: drop-shadow(0 0 20px cyan); }
        }
        .mascot-effects {
          animation: spin3d 3s linear infinite, float 2s ease-in-out infinite alternate;
          transform-style: preserve-3d;
        }
        .glow-pulse {
          animation: glowPulse 1.5s ease-in-out infinite alternate;
        }
      `}</style>
      
      {!open && (
        <div
          onMouseDown={handleMouseDown}
          onClick={() => !isDragging && setOpen(true)}
          style={mascotStyle}
        >
          <div 
            className="mascot-effects" 
            style={{ 
              width: '100%', 
              height: '100%',
              transform: 'perspective(200px)'
            }}
          >
            <div className="glow-pulse" style={{ width: '100%', height: '100%' }}>
              <img
                src={robotMascot}
                alt="Scorpio AI Mascot"
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'contain',
                  filter: theme === 'dark' ? 'brightness(0.9) hue-rotate(180deg)' : 'none'
                }}
              />
            </div>
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
