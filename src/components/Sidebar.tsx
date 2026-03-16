<<<<<<< HEAD
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, Shield, Zap, Users, Settings, 
  Bell, FileText, Code, PieChart, Plus
} from 'lucide-react';
import ScorpionIcon from './ScorpionIcon';

const Sidebar = () => {
  const location = useLocation();
  
  const navItems = [
    { name: 'DASHBOARD', path: '/', icon: LayoutDashboard },
    { name: 'SECURITY', path: '/security', icon: Shield },
    { name: 'DEVOPS', path: '/devops', icon: Zap },
    { name: 'TEAMS', path: '/teams', icon: Users },
    { name: 'ALERTS', path: '/alerts', icon: Bell },
    { name: 'REPORTS', path: '/reports', icon: FileText },
    { name: 'INSIGHTS', path: '/insights', icon: Code },
    { name: 'AI ANALYTICS', path: '/ai-insights', icon: PieChart },
  ];

  const bottomItems = [
    { name: 'SETTINGS', path: '/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-[#0D0D0D] border-r border-[#1E1E1E] flex flex-col h-screen sticky top-0 z-50">
      <div className="p-6 flex items-center gap-3">
        <ScorpionIcon className="w-8 h-8" />
        <span className="text-xl font-black italic tracking-tighter text-white">SCORPION</span>
      </div>

      <div className="px-4 mb-8">
        <button className="w-full py-3 bg-[#E8440A] hover:bg-[#FF5A1F] text-white rounded-lg flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-[#E8440A]/20 active:scale-95">
          <Plus className="w-4 h-4" /> NEW SCAN +
        </button>
      </div>

      <nav className="flex-1 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg group transition-all relative ${
                isActive 
                  ? 'bg-white/5 text-white' 
                  : 'text-[#666666] hover:text-white hover:bg-white/5'
              }`}
            >
              {isActive && (
                <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-[#E8440A] rounded-r-full" />
              )}
              <item.icon className={`w-4 h-4 transition-colors ${isActive ? 'text-[#E8440A]' : 'group-hover:text-[#E8440A]'}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{item.name}</span>
            </Link>
=======
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
>>>>>>> 98f3544 (ui updates)
          );
        })}
      </nav>

<<<<<<< HEAD
      <div className="p-4 border-t border-[#1E1E1E]">
        {bottomItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg group transition-all ${
                isActive 
                  ? 'bg-white/5 text-white' 
                  : 'text-[#666666] hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon className={`w-4 h-4 transition-colors ${isActive ? 'text-[#E8440A]' : 'group-hover:text-[#E8440A]'}`} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
};

export default Sidebar;
=======
      {/* Bottom */}
      <div style={{ padding: '20px', borderTop: '1px solid #1E1E1E', color: '#444', fontSize: '0.75rem' }}>
        SCORPION v2.0
      </div>
    </div>
  );
}
>>>>>>> 98f3544 (ui updates)
