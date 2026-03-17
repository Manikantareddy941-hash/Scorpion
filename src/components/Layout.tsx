import React from 'react';
import Sidebar from './Sidebar';
import { useAuth } from '../contexts/AuthContext';
import { Search, Bell, Sun, Moon, ChevronDown } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)] flex items-center justify-between px-8 sticky top-0 z-40">
          <div className="flex items-center bg-[var(--bg-card)] rounded-lg px-4 py-2 border border-[var(--border-subtle)] w-96">
            <Search className="w-4 h-4 text-[#666666] mr-2" />
            <input 
              type="text" 
              placeholder="QUICK SEARCH INFRASTRUCTURE..." 
              className="bg-transparent border-none outline-none text-[10px] w-full font-bold uppercase tracking-widest text-[var(--text-primary)] placeholder-[#444444]" 
            />
          </div>

          <div className="flex items-center gap-6">
            <button className="relative p-2 text-[#666666] hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#E8440A] rounded-full border-2 border-[var(--bg-primary)]" />
            </button>
            
            <button 
              onClick={toggleTheme}
              className="p-2 text-[#666666] hover:text-white transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-3 pl-6 border-l border-[var(--border-subtle)]">
              <div className="w-8 h-8 bg-[var(--border-subtle)] rounded-full flex items-center justify-center text-[10px] font-black text-[var(--text-primary)] border border-[#E8440A]">
                {user?.email?.[0].toUpperCase()}
              </div>
              <div className="hidden md:block">
                <p className="text-[10px] font-black text-[var(--text-primary)] leading-none">OPERATOR</p>
                <p className="text-[9px] font-bold text-[#666666] uppercase tracking-tighter mt-1">{user?.email}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-[#444444]" />
            </div>
          </div>
        </header>

        <main className="flex-1 p-8 overflow-y-auto custom-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
