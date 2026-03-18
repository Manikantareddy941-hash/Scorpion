import React from 'react';
import Sidebar from './Sidebar';
import { useAuth } from '../contexts/AuthContext';
import { Search, Bell, Sun, Moon, ChevronDown, Eye, Snowflake } from 'lucide-react';
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
    <div className="flex flex-col min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="flex flex-1">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] flex items-center justify-between px-8 sticky top-0 z-40">
            <div className="flex items-center bg-[var(--bg-card)] rounded-lg px-4 py-2 border border-[var(--border-subtle)] w-96">
              <Search className="w-4 h-4 text-[var(--text-secondary)] mr-2" />
              <input 
                type="text" 
                placeholder="QUICK SEARCH INFRASTRUCTURE..." 
                className="bg-transparent border-none outline-none text-[10px] w-full font-bold uppercase tracking-widest text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50" 
              />
            </div>

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
                  {(theme === 'snow-light' || theme === 'snow-dark') && <Snowflake className="w-5 h-5" />}
                  <ChevronDown className={`w-3 h-3 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`} />
                </button>

                {isThemeOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsThemeOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-2 z-50 animate-in fade-in zoom-in duration-200">
                      {[
                        { id: 'light', label: 'Light Mode', icon: Sun },
                        { id: 'dark', label: 'Dark Mode', icon: Moon },
                        { id: 'eye-protection', label: 'Eye Protection', icon: Eye },
                        { id: 'snow-light', label: 'Snow Light', icon: Snowflake },
                        { id: 'snow-dark', label: 'Snow Dark', icon: Snowflake },
                      ].map((t) => (
                        <button
                          key={t.id}
                          onClick={() => { setTheme(t.id as any); setIsThemeOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-[10px] font-black uppercase tracking-widest italic transition-colors
                            ${theme === t.id ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'text-[var(--text-secondary)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-primary)]'}`}
                        >
                          <t.icon className="w-4 h-4" />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 pl-6 border-l border-[var(--border-subtle)]">
                <div className="w-8 h-8 bg-[var(--bg-secondary)] rounded-full flex items-center justify-center overflow-hidden text-[10px] font-black text-[var(--text-primary)] border border-[var(--accent-primary)]">
                  {((user?.prefs as any)?.profilePic) ? (
                    <img src={(user?.prefs as any).profilePic} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    user?.email?.[0].toUpperCase()
                  )}
                </div>
                <div className="hidden md:block">
                  <p className="text-[10px] font-black text-[var(--text-primary)] leading-none">OPERATOR</p>
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-tighter mt-1">{user?.email}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto custom-scrollbar">
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
