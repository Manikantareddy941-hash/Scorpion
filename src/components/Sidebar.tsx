import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Shield, Bell, Settings, Users, BarChart2 } from 'lucide-react';
import NewScanModal from './NewScanModal';
import UVScanOverlay from './UVScanOverlay';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Shield, label: 'Security', path: '/security' },
  { icon: BarChart2, label: 'Reports', path: '/reports' },
  { icon: Users, label: 'Teams', path: '/teams' },
  { icon: Bell, label: 'Alerts', path: '/alerts' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showScan, setShowScan] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState('');
  const { getJWT } = useAuth();
  const [scanId, setScanId] = useState<string | null>(null);

  const handleScan = async (data: any) => {
    setShowScan(false);
    setScanTarget(data.type === 'github' ? data.value : `${data.value.length} local files`);
    setScanning(true);

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
        body: JSON.stringify({ url: data.type === 'github' ? data.value : `upload://${Date.now()}` })
      });
      const repo = await repoRes.json();
      
      if (!repo.$id) throw new Error(repo.error || 'Failed to register repository');

      // 2. Trigger Scan
      const scanRes = await fetch(`${apiBase}/api/repos/${repo.$id}/scan`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const scanResult = await scanRes.json();
      
      if (scanResult.scanId) {
        setScanId(scanResult.scanId);
      } else {
        throw new Error(scanResult.error || 'Failed to start scan');
      }
    } catch (err: any) {
      console.error('Scan trigger failed:', err);
      alert(`Scan failed to start: ${err.message}`);
      setScanning(false);
    }
  };

  return (
    <div style={{ width: '220px', minHeight: '100vh', background: 'var(--bg-primary)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', padding: '24px 0' }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 20px 24px' }}>
        <img src="/src/assets/final_logo_png.png" alt="Logo" style={{ width: 28, height: 28, objectFit: 'contain' }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '0.15em' }}>SCORPION</span>
      </div>

      {/* New Scan Button */}
      <div style={{ padding: '0 16px 24px' }}>
        <button onClick={() => setShowScan(true)} style={{ width: '100%', background: '#E8440A', color: 'white', border: 'none', borderRadius: '6px', padding: '10px', fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.1em', cursor: 'pointer' }}>
          + NEW SCAN
        </button>
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
      <nav style={{ flex: 1 }}>
        {navItems.map(({ icon: Icon, label, path }) => {
          const active = location.pathname === path;
          return (
            <div key={path} onClick={() => navigate(path)}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', cursor: 'pointer', borderLeft: active ? '3px solid #E8440A' : '3px solid transparent', background: active ? 'var(--bg-card)' : 'transparent', color: active ? '#E8440A' : '#666666', fontSize: '0.85rem', fontWeight: active ? 700 : 400, letterSpacing: '0.05em', transition: 'all 0.15s' }}>
              <Icon size={16} />
              {label}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '20px', borderTop: '1px solid var(--border-subtle)', color: '#444', fontSize: '0.75rem' }}>
        SCORPION v2.0
      </div>
    </div>
  );
}
