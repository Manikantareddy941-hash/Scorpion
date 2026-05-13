import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { useScan } from '../contexts/ScanContext';
import { 
    Sun, Moon, ChevronDown, Eye, Waves, Cpu, Droplets,
    Activity, ListTodo, Shield, Settings, LogOut, Bell, GitBranch, ShieldX, Clock, Layout
} from 'lucide-react';

interface NavbarProps {
    className?: string;
}

const Navbar: React.FC<NavbarProps> = ({ className = '' }) => {
    const { user, signOut } = useAuth();
    const { theme, setTheme } = useTheme();
    const { activeScan, updateScan } = useScan();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [isNavOpen, setIsNavOpen] = useState(false);
    const [showThemeMenu, setShowThemeMenu] = useState(false);

    // Notifications state
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        // Fetch initial notifications
        databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [Query.orderDesc('$createdAt'), Query.limit(10)]).then(res => {
            setNotifications(res.documents);
            setUnreadCount(res.documents.filter(d => !d.read).length);
        }).catch(err => console.error(err));
    }, []);

    const markAllAsRead = async () => {
        setUnreadCount(0);
        setNotifications(prev => prev.map(n => ({...n, read: true})));
    };


    return (
        <nav className={`h-16 flex items-center justify-between px-8 z-40 transition-all duration-300 ${
            theme === 'liquid-glass' ? '' : 
            theme === 'underwater' ? 'bg-[rgba(0,40,80,0.8)] backdrop-blur-[10px]' :
            theme === 'eye-protection' ? 'bg-transparent' :
            'bg-[var(--bg-primary)]/50 backdrop-blur-md'
        } ${className}`}>
            {/* Left: Dynamic Greeting */}
            <div className="flex items-center min-w-[200px] animate-in fade-in duration-700">
                <h1 className="text-[20px] font-bold text-[var(--text-primary)] transition-all">
                    {(() => {
                        const hour = new Date().getHours();
                        const firstName = user?.name?.split(' ')[0] || 'Operator';
                        if (hour >= 5 && hour < 12) return `Good Morning, ${firstName} 🌅`;
                        if (hour >= 12 && hour < 17) return `Good Afternoon, ${firstName} ☀️`;
                        if (hour >= 17 && hour < 21) return `Good Evening, ${firstName} 🌆`;
                        return `Welcome Back, ${firstName} 🌙`;
                    })()}
                </h1>
            </div>

            {/* Center Area: Background Scan Indicator */}
            <div className="hidden md:flex items-center flex-1 justify-center max-w-2xl mx-8 gap-6">

                {/* Background Scan Indicator */}
                {activeScan && !activeScan.isScanning && (
                    <div 
                        onClick={() => updateScan({ isScanning: true })}
                        className="flex items-center gap-4 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl px-4 py-2 cursor-pointer hover:border-[var(--accent-primary)]/40 transition-all animate-in fade-in slide-in-from-right-4"
                    >
                        <div className="relative">
                            <Shield className="w-4 h-4 text-[var(--accent-primary)] animate-pulse" />
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-[var(--accent-primary)] rounded-full animate-ping" />
                        </div>
                        <div className="hidden lg:block min-w-[120px]">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[9px] font-black uppercase italic text-[var(--text-primary)] truncate max-w-[80px]">
                                    {activeScan.repoName}
                                </span>
                                <span className="text-[9px] font-black text-[var(--accent-primary)]">{activeScan.progress}%</span>
                            </div>
                            <div className="h-1 w-full bg-black/10 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-[var(--accent-primary)] transition-all duration-500" 
                                    style={{ width: `${activeScan.progress}%` }} 
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <div className="flex items-center gap-1">
                            <button 
                                onClick={() => {
                                    const nextTheme = theme === 'light' ? 'dark' : 'light';
                                    setTheme(nextTheme);
                                }}
                                className="p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-md transition-all"
                                title={t('dashboard.toggle_theme')}
                            >
                                {theme === 'light' && <Sun size={20} />}
                                {theme === 'dark' && <Moon size={20} />}
                                {theme === 'eye-protection' && <Eye size={20} />}
                                {theme === 'underwater' && <Waves size={20} />}
                                {theme === 'matrix' && <Cpu size={20} />}
                                {theme === 'liquid-glass' && <Droplets size={20} />}
                            </button>
                            <button 
                                onClick={() => setShowThemeMenu(!showThemeMenu)}
                                className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-all"
                            >
                                <ChevronDown size={14} className={`transition-transform ${showThemeMenu ? 'rotate-180' : ''}`} />
                            </button>
                        </div>

                        {showThemeMenu && (
                            <>
                                <div className="fixed inset-0 z-[9998]" onClick={() => setShowThemeMenu(false)} />
                                <div className="absolute right-0 mt-2 p-3 bg-[var(--bg-card)] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-[var(--border-subtle)] z-[9999] animate-in fade-in zoom-in duration-200 grid grid-cols-3 gap-2 min-w-[180px]">
                                {
                                    [
                                        { id: 'light', icon: Sun },
                                        { id: 'dark', icon: Moon },
                                        { id: 'eye-protection', icon: Eye },
                                        { id: 'underwater', icon: Waves },
                                        { id: 'matrix', icon: Cpu },
                                        { id: 'liquid-glass', icon: Droplets },
                                    ].map((themeOption) => (
                                        <button
                                            key={themeOption.id}
                                            onClick={() => { setTheme(themeOption.id as any); setShowThemeMenu(false); }}
                                            className={`rounded-xl transition-all flex items-center justify-center
                                                ${theme === themeOption.id ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'}`}
                                            style={{ 
                                                width: themeOption.id === 'eye-protection' ? '46px' : '40px', 
                                                height: themeOption.id === 'eye-protection' ? '46px' : '40px' 
                                            }}
                                        >
                                            <themeOption.icon size={themeOption.id === 'eye-protection' ? 20 : 16} />
                                        </button>
                                    ))
                                }
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="relative">
                    <button 
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors relative"
                    >
                        <Bell size={18} />
                        {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--status-error)] rounded-full border-2 border-transparent"></span>}
                    </button>
                    
                    {showNotifications && (
                        <>
                            <div className="fixed inset-0 z-[9998]" onClick={() => setShowNotifications(false)} />
                            <div className="absolute right-0 mt-2 w-80 bg-[var(--bg-card)] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-[var(--border-subtle)] z-[9999] animate-in fade-in zoom-in duration-200 overflow-hidden">
                                <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                                    <h3 className="text-xs font-bold text-[var(--text-primary)]">Notifications</h3>
                                    {unreadCount > 0 && (
                                        <button 
                                            onClick={markAllAsRead}
                                            className="text-[10px] text-[var(--accent-primary)] hover:underline font-bold"
                                        >
                                            Mark all as read
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-[300px] overflow-y-auto custom-scrollbar flex flex-col">
                                    {notifications.length > 0 ? notifications.map((n, i) => (
                                        <div key={i} className={`p-4 border-b border-[var(--border-subtle)] last:border-none hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer ${!n.read ? 'bg-[var(--accent-primary)]/5' : ''}`}>
                                            <div className="flex gap-3">
                                                <div className="mt-1 shrink-0">
                                                    <div className={`w-2 h-2 rounded-full ${n.severity === 'high' || n.severity === 'critical' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-medium text-[var(--text-primary)] mb-1 leading-snug">{n.title || n.message}</p>
                                                    <p className="text-[10px] text-[var(--text-secondary)]">
                                                        {new Date(n.$createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="p-8 text-center text-xs text-[var(--text-secondary)]">No new notifications</div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="relative flex items-center">
                    <button
                        onClick={() => setIsNavOpen(!isNavOpen)}
                        className="flex items-center gap-3 p-1 rounded-2xl hover:bg-[var(--bg-secondary)] transition-all text-left group border border-transparent hover:border-[var(--border-subtle)]"
                    >
                        <div className="w-8 h-8 bg-[var(--bg-secondary)] rounded-md flex items-center justify-center overflow-hidden text-[10px] font-bold text-[var(--text-primary)] border border-[var(--accent-primary)] group-hover:scale-105 transition-transform">
                            {((user?.prefs as any)?.profilePic) ? (
                                <img src={(user?.prefs as any).profilePic} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                user?.email?.[0].toUpperCase()
                            )}
                        </div>
                        <div className="hidden md:block pl-1 pr-1">
                            <p className="text-[11px] font-bold text-[var(--text-primary)] leading-none">{user?.email?.split('@')[0] || 'Liza'}</p>
                        </div>
                        <div className="pr-2">
                            <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                        </div>
                    </button>

                    {isNavOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                            <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-2 z-50 animate-in fade-in zoom-in duration-200">
                                {[
                                    { icon: Activity, label: 'Analytics', path: '/dashboard' },
                                    { icon: ListTodo, label: 'Reports', path: '/reports' },
                                    { icon: Shield, label: 'Security', path: '/scans' },
                                    { icon: Settings, label: 'Settings', path: '/settings' },
                                ].map((item) => (
                                    <button
                                        key={item.label}
                                        onClick={() => { navigate(item.path); setIsNavOpen(false); }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                    >
                                        <item.icon className="w-4 h-4" />
                                        {item.label}
                                    </button>
                                ))}
                                <div className="my-2 border-t border-[var(--border-subtle)]" />
                                <button
                                    onClick={signOut}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest italic text-[var(--status-error)] hover:bg-[var(--status-error)]/5 transition-colors"
                                >
                                    <LogOut className="w-4 h-4" />
                                    {t('dashboard.disconnect')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
