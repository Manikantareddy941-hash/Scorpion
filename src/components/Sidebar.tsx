import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Bell, Settings, Users, BarChart2, ListTodo } from 'lucide-react';
import NewScanModal from './NewScanModal';
import UVScanOverlay from './UVScanOverlay';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: ListTodo, label: 'Tasks', path: '/tasks' },
  { icon: BarChart2, label: 'Reports', path: '/reports' },
  { icon: Users, label: 'Teams', path: '/teams' },
  { icon: Bell, label: 'Alerts', path: '/alerts' },
];

const settingsItem = { icon: Settings, label: 'Settings', path: '/settings' };

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showScan, setShowScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState('');
  const { getJWT } = useAuth();
  const { getLogoFilter, getLogoBlendMode } = useTheme();
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleScan = async (data: any) => {
    setShowScan(false);
    setScanTarget(data.type === 'github' ? data.value : `${data.value.length} local files`);
    setScanning(true);

    setScanError(null);

    try {
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const token = await getJWT();

      if (!token) throw new Error('Not authenticated');

      // 1. Sync/Create Repo
      const repoRes = await fetch(`${apiBase}/api/repos`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          url: data.type === 'github' ? data.value : `upload://${Date.now()}`,
          visibility: 'private'
        })
      });
      const repo = await repoRes.json();
      
      if (!repo.$id) throw new Error(repo.error || 'Failed to register repository');

      // 2. Trigger Scan
      const scanRes = await fetch(`${apiBase}/api/repos/${repo.$id}/scan`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ visibility: 'public' })
      });
      const scanResult = await scanRes.json();
      
      if (scanResult.scanId) {
        setScanId(scanResult.scanId);
      } else {
        throw new Error(scanResult.error || 'Failed to start scan');
      }
    } catch (err: any) {
      console.error('Scan trigger failed:', err);
      setScanError(err.message || 'Failed to start scan');
      setScanning(false);
    }
  };

  return (
    <div className="shrink-0" style={{ width: '220px', background: 'var(--bg-primary)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', padding: '24px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 20px 24px' }}>
        <img 
            src={logoImg} 
            alt="Scorpion Logo" 
            style={{ 
                width: 44, 
                height: 44, 
                objectFit: 'contain', 
                filter: getLogoFilter(), 
                mixBlendMode: getLogoBlendMode() 
            }} 
        />
        <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '0.15em', fontStyle: 'italic' }}>SCORPION</span>
      </div>

      {/* New Scan Button */}
      <div style={{ padding: '0 16px 24px' }}>
        <button onClick={() => setShowScan(true)} style={{ width: '100%', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '10px', fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.1em', cursor: 'pointer' }}>
          + NEW SCAN
        </button>
        {scanError && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-500/30 rounded text-[10px] text-red-500 italic font-medium animate-in fade-in slide-in-from-top-1">
            ⚠️ {scanError}
          </div>
        )}
        {showScan && <NewScanModal onClose={() => setShowScan(false)} onScan={handleScan} />}
      </div>

      {scanning && (
        <UVScanOverlay
          scanTarget={scanTarget}
          scanId={scanId}
          onComplete={() => {
            setScanning(false);
            navigate('/scan-results', { state: { scanTarget, scanId } });
          }}
        />
      )}

      {/* Nav Items */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
            {navItems.map(({ icon: Icon, label, path }) => {
            const active = location.pathname === path;
            return (
                <div key={path} onClick={() => navigate(path)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', cursor: 'pointer', borderLeft: active ? '3px solid var(--accent-primary)' : '3px solid transparent', background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: active ? 700 : 400, letterSpacing: '0.05em', transition: 'all 0.15s' }}>
                <Icon size={16} />
                {label}
                </div>
            );
            })}
        </div>
      </nav>

      {/* Bottom Section: Settings + Version */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
        <div 
            onClick={() => navigate(settingsItem.path)}
            style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px', 
                padding: '16px 20px', 
                cursor: 'pointer', 
                borderLeft: location.pathname === settingsItem.path ? '3px solid var(--accent-primary)' : '3px solid transparent', 
                background: location.pathname === settingsItem.path ? 'var(--bg-card)' : 'transparent', 
                color: location.pathname === settingsItem.path ? 'var(--accent-primary)' : 'var(--text-secondary)', 
                fontSize: '0.85rem', 
                fontWeight: location.pathname === settingsItem.path ? 700 : 400, 
                letterSpacing: '0.05em', 
                transition: 'all 0.15s' 
            }}
        >
            <settingsItem.icon size={16} />
            {settingsItem.label}
        </div>
        <div style={{ padding: '12px 20px', color: 'var(--text-secondary)', fontSize: '0.75rem', opacity: 0.5 }}>
          SCORPION V1.0
        </div>
      </div>
    </div>
  );
}
