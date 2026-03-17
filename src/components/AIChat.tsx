import { useState, useRef, useEffect } from 'react';
import { X, Send, Minimize2 } from 'lucide-react';

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
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '🦂 SCORPIO AI online. I can help you fix vulnerabilities, debug code issues, or guide you through the platform. What do you need?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

      // Build conversation history in Gemini format
      // Gemini requires conversations to start with a 'user' turn,
      // so skip any leading assistant/model messages (e.g. the welcome message)
      const firstUserIndex = messages.findIndex(m => m.role === 'user');
      const validHistory = firstUserIndex === -1 ? [] : messages.slice(firstUserIndex);
      const geminiHistory = validHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
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
        const errData = await response.json();
        console.error('Gemini API error:', errData);
        throw new Error(errData.error?.message || 'API error');
      }

      const data = await response.json();
      console.log('Gemini response:', data);
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Connection error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Chat Trigger Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[100] hover:scale-110 transition-all duration-300 group"
          aria-label="Toggle AI Chat"
        >
          <div className="w-14 h-14 bg-white rounded-full shadow-xl flex items-center justify-center cursor-pointer">
            <svg viewBox="0 0 100 100" width="40" height="40" xmlns="http://www.w3.org/2000/svg">
              {/* Body segments */}
              <ellipse cx="50" cy="57" rx="10" ry="14" fill="#f97316"/>
              <ellipse cx="50" cy="43" rx="9" ry="8" fill="#f97316"/>
              {/* Head */}
              <ellipse cx="50" cy="33" rx="8" ry="7" fill="#f97316"/>
              {/* Eyes */}
              <circle cx="46" cy="31" r="1.8" fill="white"/>
              <circle cx="54" cy="31" r="1.8" fill="white"/>
              {/* Left pincer arm */}
              <path d="M43 30 Q35 23 27 17" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
              {/* Left pincer top */}
              <path d="M27 17 Q20 11 17 14" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
              {/* Left pincer bottom */}
              <path d="M27 17 Q19 15 18 20" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
              {/* Right pincer arm */}
              <path d="M57 30 Q65 23 73 17" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
              {/* Right pincer top */}
              <path d="M73 17 Q80 11 83 14" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
              {/* Right pincer bottom */}
              <path d="M73 17 Q81 15 82 20" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
              {/* Left legs --> */}
              <path d="M42 48 Q33 46 24 44" stroke="#f97316" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              <path d="M41 55 Q32 55 23 57" stroke="#f97316" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              <path d="M41 62 Q32 64 23 68" stroke="#f97316" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              {/* Right legs --> */}
              <path d="M58 48 Q67 46 76 44" stroke="#f97316" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              <path d="M59 55 Q68 55 77 57" stroke="#f97316" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              <path d="M59 62 Q68 64 77 68" stroke="#f97316" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              {/* Tail segment 1 --> */}
              <path d="M50 71 Q53 79 60 83" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
              {/* Tail segment 2 --> */}
              <path d="M60 83 Q70 87 74 80" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
              {/* Tail segment 3 --> */}
              <path d="M74 80 Q80 70 74 62" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round"/>
              {/* Tail segment 4 --> */}
              <path d="M74 62 Q68 53 60 52" stroke="#f97316" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
              {/* Tail segment 5 curling inward --> */}
              <path d="M60 52 Q55 48 54 43" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
              {/* Stinger --> */}
              <path d="M54 43 Q52 37 56 33" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round"/>
              <ellipse cx="57" cy="31" rx="3" ry="4.5" fill="#f97316" transform="rotate(30 57 31)"/>
            </svg>
          </div>
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', width: '380px', maxWidth: '95vw', background: 'var(--bg-card)', border: '1px solid #E8440A', borderRadius: '16px', zIndex: 999, display: 'flex', flexDirection: 'column', boxShadow: '0 0 30px rgba(232,68,10,0.2)' }}>

          {/* Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(232,68,10,0.1)', borderRadius: '16px 16px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img 
                src="/src/assets/final_logo_png.png" 
                style={{ 
                  width: '28px', 
                  height: '28px', 
                  objectFit: 'contain'
                }} 
              />
              <div>
                <div style={{ color: '#E8440A', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.1em' }}>SCORPIO AI</div>
                <div style={{ color: '#666', fontSize: '0.7rem' }}>Security Intelligence Assistant</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setMinimized(!minimized)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Minimize2 size={16} /></button>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>
          </div>

          {/* Messages */}
          {!minimized && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', maxHeight: '380px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {messages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '80%', padding: '10px 14px', borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: msg.role === 'user' ? '#E8440A' : 'var(--bg-primary)',
                      color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: '1.5', whiteSpace: 'pre-wrap'
                    }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div style={{ display: 'flex', gap: '4px', padding: '10px 14px', background: 'var(--bg-primary)', borderRadius: '12px', width: 'fit-content' }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E8440A', animation: `bounce 1s ${i*0.2}s infinite` }} />)}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '8px' }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  placeholder="Ask SCORPIO AI..."
                  style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()}
                  style={{ background: '#E8440A', border: 'none', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer', opacity: loading || !input.trim() ? 0.4 : 1 }}>
                  <Send size={16} color="white" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
