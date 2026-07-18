import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useScan } from '../contexts/ScanContext';
import {
    ChevronDown,
    Activity, ListTodo, Shield, Settings, LogOut, Bell
} from 'lucide-react';

interface NavbarProps {
    className?: string;
}

const Navbar: React.FC<NavbarProps> = ({ className = '' }) => {
    const { user, signOut, getJWT } = useAuth();
    const { activeScan, updateScan } = useScan();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [isNavOpen, setIsNavOpen] = useState(false);

    // Notifications state
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    // The notifications collection has no "read" attribute (its status field tracks
    // delivery, not read-receipts), so read state is persisted per-user in
    // localStorage, which survives reloads.
    const readStorageKey = user ? `scorpion_read_notifications_${user.$id}` : '';
    const getReadIds = (): Set<string> => {
        if (!readStorageKey) return new Set();
        try {
            return new Set(JSON.parse(localStorage.getItem(readStorageKey) || '[]'));
        } catch {
            return new Set();
        }
    };

    useEffect(() => {
        if (!user) return;
        // Scoped to the caller by the backend rather than by a query the
        // browser supplies. The filter here was correct, but a filter the
        // client chooses is a filter the client can drop.
        getJWT()
            .then((token) => fetch('/api/notifications', {
                headers: { Authorization: `Bearer ${token}` },
            }))
            .then((res) => {
                if (!res.ok) throw new Error(`notifications failed: ${res.status}`);
                return res.json();
            })
            .then((docs) => {
                const readIds = getReadIds();
                const withRead = (Array.isArray(docs) ? docs.slice(0, 10) : [])
                    .map((d: any) => ({ ...d, read: readIds.has(d.$id) }));
                setNotifications(withRead);
                setUnreadCount(withRead.filter((d: any) => !d.read).length);
            })
            .catch(err => console.error(err));
        // getReadIds only reads localStorage keyed by the same user; re-running
        // solely on user change is intended, so it is deliberately not a dep.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const markAllAsRead = async () => {
        setUnreadCount(0);
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        if (readStorageKey) {
            const allIds = notifications.map(n => n.$id);
            const merged = Array.from(new Set([...getReadIds(), ...allIds]));
            localStorage.setItem(readStorageKey, JSON.stringify(merged));
        }
    };


    return (
        <nav className={`h-14 flex items-center justify-between px-6 z-40 border-b border-[var(--border-subtle)] bg-white/85 backdrop-blur ${className}`}>
            {/* Left: Greeting */}
            <div className="flex items-center min-w-[200px]">
                <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
                    {(() => {
                        const hour = new Date().getHours();
                        const firstName = user?.name?.split(' ')[0] || 'Operator';
                        if (hour >= 5 && hour < 12) return `Good morning, ${firstName}`;
                        if (hour >= 12 && hour < 17) return `Good afternoon, ${firstName}`;
                        if (hour >= 17 && hour < 21) return `Good evening, ${firstName}`;
                        return `Welcome back, ${firstName}`;
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
                                <span className="text-[10px] font-medium text-[var(--text-primary)] truncate max-w-[80px]">
                                    {activeScan.repoName}
                                </span>
                                <span className="text-[10px] font-semibold tabular-nums text-[var(--accent-primary)]">{activeScan.progress}%</span>
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
            <div className="flex items-center gap-3">
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
                            <div className="absolute right-0 mt-2 w-80 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] z-[9999] animate-in fade-in zoom-in duration-200 overflow-hidden" style={{ boxShadow: 'var(--card-shadow)' }}>
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
                            <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] py-2 z-50 animate-in fade-in zoom-in duration-200" style={{ boxShadow: 'var(--card-shadow)' }}>
                                {[
                                    { icon: Activity, label: 'Analytics', path: '/dashboard' },
                                    { icon: ListTodo, label: 'Reports', path: '/reports' },
                                    { icon: Shield, label: 'Security', path: '/scans' },
                                    { icon: Settings, label: 'Settings', path: '/settings' },
                                ].map((item) => (
                                    <button
                                        key={item.label}
                                        onClick={() => { navigate(item.path); setIsNavOpen(false); }}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                    >
                                        <item.icon className="w-4 h-4" />
                                        {item.label}
                                    </button>
                                ))}
                                <div className="my-2 border-t border-[var(--border-subtle)]" />
                                <button
                                    onClick={signOut}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-[var(--status-error)] hover:bg-[var(--status-error)]/5 transition-colors"
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
