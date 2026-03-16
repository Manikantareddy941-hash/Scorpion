import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Shield, GitBranch, Bell, Settings, Users, BarChart2, Zap } from 'lucide-react';
import ScorpionIcon from './ScorpionIcon';
import NewScanModal from './NewScanModal';
import UVScanOverlay from './UVScanOverlay';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Shield, label: 'Security', path: '/security' },
  { icon: GitBranch, label: 'DevOps', path: '/devops' },
  { icon: BarChart2, label: 'Reports', path: '/reports' },
  { icon: Zap, label: 'AI Insights', path: '/ai-insights' },
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

  const handleScan = (data: any) => {
    setShowScan(false);
    setScanTarget(data.type === 'github' ? data.value : `${data.value.length} local files`);
    setScanning(true);
  };

  return (
    <div style={{ width: '220px', minHeight: '100vh', background: '#0D0D0D', borderRight: '1px solid #1E1E1E', display: 'flex', flexDirection: 'column', padding: '24px 0' }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 20px 24px' }}>
        <ScorpionIcon size={28} color="#E8440A" />
        <span style={{ color: '#E8440A', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '0.15em' }}>SCORPION</span>
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
          onComplete={() => {
            setScanning(false);
            navigate('/scan-results', { state: { scanTarget } });
          }}
        />
      )}

      {/* Nav Items */}
      <nav style={{ flex: 1 }}>
        {navItems.map(({ icon: Icon, label, path }) => {
          const active = location.pathname === path;
          return (
            <div key={path} onClick={() => navigate(path)}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', cursor: 'pointer', borderLeft: active ? '3px solid #E8440A' : '3px solid transparent', background: active ? '#1a1a1a' : 'transparent', color: active ? '#E8440A' : '#666666', fontSize: '0.85rem', fontWeight: active ? 700 : 400, letterSpacing: '0.05em', transition: 'all 0.15s' }}>
              <Icon size={16} />
              {label}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div style={{ padding: '20px', borderTop: '1px solid #1E1E1E', color: '#444', fontSize: '0.75rem' }}>
        SCORPION v2.0
      </div>
    </div>
  );
}
