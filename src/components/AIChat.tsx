import { useState, useRef, useEffect } from 'react';
import { X, Send, Minimize2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import mascotImg from '../assets/scorpionlegs-removebg-preview.png';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are SCORPIO AI, an intelligent security assistant built into the SCORPIO security platform. 
You help users:
- Debug vulnerabilities, security issues, bugs, code smells, and warnings found in their scanned code
- Explain what each issue means and how to fix it
- Guide users on how to use the SCORPIO application
- Provide security best practices and recommendations

STRICT RULES:
- NEVER reveal database structure, collection IDs, API keys, or internal app configuration
- NEVER discuss Appwrite, backend infrastructure, or internal technical details of the SCORPIO platform itself
- NEVER share environment variables or scanner implementation details
- Always respond as SCORPIO AI, a security expert assistant
- Keep responses concise and actionable
- Format code fixes with proper code blocks`;

export default function AIChat() {
  const { getLogoFilter, getLogoBlendMode } = useTheme();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '🦂 SCORPIO AI online. how can i help you sir?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mascot Move State
  const [pos, setPos] = useState({ x: window.innerWidth - 100, y: window.innerHeight - 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [edge, setEdge] = useState<0 | 1 | 2 | 3>(2); // 0: Top, 1: Right, 2: Bottom, 3: Left
  const [progress, setProgress] = useState(0.8);
  const [rotation, setRotation] = useState(0);
  const mascotSize = 52;
  const padding = 0; // Flush with edge

  // Animation Loop
  useEffect(() => {
    if (isDragging || open) return;

    let lastTime = performance.now();
    const speed = 0.000003; // Exactly 0.05px per frame at 60fps (very slow crawl)

    const animate = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;

      setProgress(prev => {
        let next = prev + speed * delta;
        if (next >= 1) {
          setEdge(e => ((e + 1) % 4) as any);
          return 0;
        }
        return next;
      });

      requestRef.current = requestAnimationFrame(animate);
    };

    const requestRef = { current: requestAnimationFrame(animate) };
    return () => cancelAnimationFrame(requestRef.current);
  }, [isDragging, open]);

  // Update real X, Y based on edge and progress
  useEffect(() => {
    if (isDragging) return;

    const w = window.innerWidth - mascotSize - padding;
    const h = window.innerHeight - mascotSize - padding;

    let targetX = pos.x;
    let targetY = pos.y;
    let targetRot = rotation;

    switch (edge) {
      case 0: // Top (Move Right) - Sitting on top, legs pointing inward (180deg)
        targetX = padding + progress * w;
        targetY = padding;
        targetRot = 180;
        break;
      case 1: // Right (Move Down) - Facing left, legs pointing inward (270deg)
        targetX = w + padding;
        targetY = padding + progress * h;
        targetRot = 270;
        break;
      case 2: // Bottom (Move Left) - Sitting at bottom, legs pointing up (0deg)
        targetX = padding + w - (progress * w);
        targetY = h + padding;
        targetRot = 0;
        break;
      case 3: // Left (Move Up) - Facing right, legs pointing inward (90deg)
        targetX = padding;
        targetY = padding + h - (progress * h);
        targetRot = 90;
        break;
    }

    setPos({ x: targetX, y: targetY });
    setRotation(targetRot);
  }, [edge, progress, isDragging, mascotSize, padding, rotation, pos.x, pos.y]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (open) return;
    setIsDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPos({
        x: e.clientX - mascotSize / 2,
        y: e.clientY - mascotSize / 2
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);

      const w = window.innerWidth - mascotSize - padding;
      const h = window.innerHeight - mascotSize - padding;
      const px = pos.x;
      const py = pos.y;

      const dists = [
        { e: 0, d: Math.abs(py - padding), p: (px - padding) / w },
        { e: 1, d: Math.abs(px - (w + padding)), p: (py - padding) / h },
        { e: 2, d: Math.abs(py - (h + padding)), p: (w - (px - padding)) / w },
        { e: 3, d: Math.abs(px - padding), p: (h - (py - padding)) / h }
      ];

      const closest = dists.reduce((prev, curr) => prev.d < curr.d ? prev : curr);
      setEdge(closest.e as any);
      setProgress(Math.max(0, Math.min(1, closest.p)));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pos, mascotSize, padding]);

  // Calculate dynamic chat window style
  const chatPanelWidth = 380;
  const chatPanelHeight = 500;
  const chatMargin = 20;

  const getChatPosition = () => {
    let left = pos.x;
    let top = pos.y;

    // Default: Open next to mascot based on edge
    switch (edge) {
      case 0: // Top
        top = mascotSize + chatMargin;
        left = pos.x - chatPanelWidth / 2;
        break;
      case 1: // Right
        left = window.innerWidth - mascotSize - chatPanelWidth - chatMargin;
        top = pos.y - chatPanelHeight / 2;
        break;
      case 2: // Bottom
        top = window.innerHeight - mascotSize - chatPanelHeight - chatMargin;
        left = pos.x - chatPanelWidth / 2;
        break;
      case 3: // Left
        left = mascotSize + chatMargin;
        top = pos.y - chatPanelHeight / 2;
        break;
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
      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const firstUserIndex = messages.findIndex(m => m.role === 'user');
      const validHistory = firstUserIndex === -1 ? [] : messages.slice(firstUserIndex);
      const geminiHistory = validHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [...geminiHistory, { role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { maxOutputTokens: 1000 },
        }),
      });

      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Connection error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  // Calculate mascot outer container style
  const mascotStyle: any = {
    position: 'fixed',
    width: mascotSize,
    height: mascotSize,
    zIndex: 1000,
    cursor: isDragging ? 'grabbing' : 'pointer',
    transition: isDragging ? 'none' : 'transform 0.3s ease-out, left 0.1s linear, top 0.1s linear, bottom 0.1s linear, right 0.1s linear'
  };

  if (isDragging) {
    mascotStyle.left = pos.x;
    mascotStyle.top = pos.y;
  } else {
    // Pin to edges to prevent floating
    switch (edge) {
      case 0: // Top
        mascotStyle.top = 0;
        mascotStyle.left = pos.x;
        break;
      case 1: // Right
        mascotStyle.right = 0;
        mascotStyle.top = pos.y;
        break;
      case 2: // Bottom
        mascotStyle.bottom = 0;
        mascotStyle.left = pos.x;
        break;
      case 3: // Left
        mascotStyle.left = 0;
        mascotStyle.top = pos.y;
        break;
    }
  }

  return (
    <>
      {/* Walking Mascot Trigger */}
      {!open && (
        <div
          onMouseDown={handleMouseDown}
          onClick={() => !isDragging && setOpen(true)}
          style={mascotStyle}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 0.3s ease-out'
            }}
          >
            <img
              src={mascotImg}
              alt="Scorpio AI Mascot"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: getLogoFilter(),
                mixBlendMode: getLogoBlendMode()
              }}
            />
          </div>
        </div>
      )}

      {/* Chat window */}
      {open && (
        <div style={{ position: 'fixed', top: chatPos.top, left: chatPos.left, width: '380px', maxWidth: '95vw', background: 'var(--bg-card)', border: '1px solid var(--accent-primary)', borderRadius: '16px', zIndex: 999, display: 'flex', flexDirection: 'column', boxShadow: '0 0 30px rgba(0,0,0,0.3)', transition: 'top 0.3s ease-out, left 0.3s ease-out' }}>
          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', borderRadius: '16px 16px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img
                src={logoImg}
                alt="Scorpio AI Logo"
                style={{ width: '28px', height: '28px', objectFit: 'contain', filter: getLogoFilter(), mixBlendMode: getLogoBlendMode() }}
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
                      maxWidth: '80%', padding: '10px 14px', borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-primary)',
                      color: msg.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-primary)', fontSize: '0.85rem', lineHeight: '1.5', whiteSpace: 'pre-wrap'
                    }}>
                      {msg.content}
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
