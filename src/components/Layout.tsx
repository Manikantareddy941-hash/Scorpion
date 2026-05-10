import React from 'react';
import Sidebar from './Sidebar';
import { useAuth } from '../contexts/AuthContext';
import { Bell, Sun, Moon, ChevronDown, Eye, Waves, Cpu, Droplets } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

import Footer from './Footer';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isThemeOpen, setIsThemeOpen] = React.useState(false);

  return (
    <div className="flex flex-col h-screen overflow-y-auto custom-scrollbar text-[var(--text-primary)]" style={{ background: 'transparent' }}>
      <div className="flex flex-1 items-start">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className={`h-16 flex items-center justify-between px-8 sticky top-0 z-40 ${theme === 'liquid-glass' ? '' : 'border-b border-[var(--border-subtle)]'}`} style={{ background: 'transparent' }}>
            <div />

            <div className="flex items-center gap-6">
              <button className="relative p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--accent-primary)] rounded-full border-2 border-[var(--bg-primary)]" />
              </button>
              
              <div className="relative">
                <button 
                  onClick={() => setIsThemeOpen(!isThemeOpen)}
                  className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
                >
                  {theme === 'light' && <Sun className="w-5 h-5" />}
                  {theme === 'dark' && <Moon className="w-5 h-5" />}
                  {theme === 'eye-protection' && <Eye className="w-5 h-5" />}
                  {theme === 'underwater' && <Waves className="w-5 h-5" />}
                  {theme === 'matrix' && <Cpu className="w-5 h-5" />}
                  {theme === 'liquid-glass' && <Droplets className="w-5 h-5" />}
                  <ChevronDown className={`w-3 h-3 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`} />
                </button>

                {isThemeOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsThemeOpen(false)} />
                    <div className="absolute right-0 mt-2 p-2 bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] z-50 animate-in fade-in zoom-in duration-200">
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { id: 'light', icon: Sun },
                          { id: 'dark', icon: Moon },
                          { id: 'eye-protection', icon: Eye },
                          { id: 'underwater', icon: Waves },
                          { id: 'matrix', icon: Cpu },
                          { id: 'liquid-glass', icon: Droplets },
                        ].map((t) => (
                          <button
                            key={t.id}
                            title={t.id}
                            onClick={() => { setTheme(t.id as any); setIsThemeOpen(false); }}
                            className={`p-3 rounded-xl transition-colors flex items-center justify-center
                              ${theme === t.id ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-secondary)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-primary)]'}`}
                          >
                            <t.icon size={18} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 pl-6 border-l border-[var(--border-subtle)] hover:bg-white/5 p-1 rounded-2xl cursor-pointer transition-all">
                <div className="w-8 h-8 bg-[var(--bg-secondary)] rounded-2xl flex items-center justify-center overflow-hidden text-[10px] font-black text-[var(--text-primary)] border border-[var(--accent-primary)]">
                  {((user?.prefs as any)?.profilePic) ? (
                    <img src={(user?.prefs as any).profilePic} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    user?.email?.[0].toUpperCase()
                  )}
                </div>
                <div className="hidden md:block pl-1 pr-3">
                  <p className="text-[10px] font-black text-[var(--text-primary)] leading-none">OPERATOR</p>
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-tighter mt-1">{user?.email}</p>
                </div>
                <div className="pr-3">
                  <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1" style={{ position: 'relative', zIndex: 1 }}>
            <div className="p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Layout;
