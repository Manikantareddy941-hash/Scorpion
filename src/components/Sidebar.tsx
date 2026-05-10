import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Bell, Settings, Users, BarChart2, ListTodo, Scale, ChevronLeft, ChevronRight, Layout, Clock, Map, GitCommit, Hammer, TestTube2, Activity, Rocket, Cpu, Shield, GitBranch } from 'lucide-react';
import NewScanModal from './NewScanModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

export default function Sidebar({ isCollapsed, setIsCollapsed }: { isCollapsed: boolean, setIsCollapsed: (c: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [showScan, setShowScan] = useState(false);
  const { theme } = useTheme();

  const navSections = [
    {
      title: 'MAIN',
      items: [
        { icon: LayoutDashboard, label: t('sidebar.dashboard'), path: '/' },
        { icon: ListTodo, label: t('sidebar.tasks'), path: '/tasks' },
        { icon: BarChart2, label: t('sidebar.reports'), path: '/reports' },
        { icon: Map, label: 'MAP', path: '/map' },
      ]
    },
    {
      title: 'PIPELINE',
      items: [
        { icon: GitBranch, label: t('sidebar.repositories'), path: '/repos' },
        { icon: TestTube2, label: 'TEST', path: '/tests' },
        { icon: Cpu, label: 'ANALYZE', path: '/analyze' },
        { icon: Rocket, label: 'RELEASE', path: '/release' },
      ]
    },
    {
      title: 'OPS',
      items: [
        { icon: Activity, label: 'MONITOR', path: '/monitor' },
        { icon: Scale, label: t('sidebar.governance'), path: '/governance' },
        { icon: Users, label: t('sidebar.teams'), path: '/teams' },
        { icon: Bell, label: t('sidebar.alerts'), path: '/alerts' },
        { icon: Clock, label: t('sidebar.audit_log'), path: '/audit' },
        { icon: Settings, label: 'SETTINGS', path: '/settings' },
      ]
    }
  ];

  const handleScan = () => setShowScan(false);

  const getThemeStyles = () => {
    switch (theme) {
      case 'underwater':
        return {
          sidebarBg: 'linear-gradient(180deg, #003366 0%, #004e8c 100%)',
          sidebarBorder: '1px solid rgba(0,200,255,0.2)',
          sectionLabel: 'rgba(100,200,255,0.6)',
          navText: 'rgba(180,230,255,0.85)',
          activeBg: '#00c8ff',
          activeText: '#ffffff',
          hoverBg: 'rgba(0,200,255,0.15)',
          newScanBg: 'linear-gradient(135deg, #00a8cc, #0077aa)',
          logoRing: '#00c8ff',
          logoText: '#ffffff',
          logoSubtext: '#00c8ff',
          collapseBtnBg: 'rgba(0,40,80,0.8)',
          collapseBtnText: '#00c8ff',
          collapseBtnHover: '#00c8ff'
        };
      case 'liquid-glass':
        return {
          sidebarBg: 'rgba(255, 255, 255, 0.08)',
          sidebarBorder: '1px solid rgba(255, 255, 255, 0.2)',
          sectionLabel: 'rgba(255, 255, 255, 0.5)',
          navText: 'rgba(255, 255, 255, 0.9)',
          activeBg: 'rgba(255, 255, 255, 0.25)',
          activeBorder: '1px solid rgba(255, 255, 255, 0.5)',
          activeText: '#ffffff',
          hoverBg: 'rgba(255, 255, 255, 0.15)',
          newScanBg: 'rgba(255, 255, 255, 0.2)',
          logoRing: 'rgba(255, 255, 255, 0.6)',
          logoText: '#ffffff',
          logoSubtext: 'rgba(255, 255, 255, 0.7)',
          accentBar: 'rgba(255, 255, 255, 0.8)',
          collapseBtnBg: 'rgba(255, 255, 255, 0.1)',
          collapseBtnText: 'rgba(255, 255, 255, 0.8)',
          collapseBtnHover: 'rgba(255, 255, 255, 0.3)'
        };
      case 'matrix':
        return {
          sidebarBg: '#000000',
          sidebarBorder: '1px solid #003b00',
          sectionLabel: '#003b00',
          navText: '#008f11',
          activeBg: 'rgba(0, 59, 0, 0.5)',
          activeBorder: '1px solid #00ff41',
          activeText: '#00ff41',
          hoverBg: 'rgba(0, 59, 0, 0.3)',
          newScanBg: '#008f11',
          logoRing: '#00ff41',
          logoText: '#00ff41',
          logoSubtext: '#008f11',
          collapseBtnBg: '#001100',
          collapseBtnText: '#008f11',
          collapseBtnHover: '#00ff41'
        };
      case 'dark':
        return {
          sidebarBg: '#141414',
          sidebarBorder: '1px solid #222222',
          sectionLabel: '#555555',
          navText: '#a0a0a0',
          activeBg: '#7bc67e',
          activeText: '#ffffff',
          hoverBg: '#1e1e1e',
          newScanBg: '#7bc67e',
          logoRing: '#eef8ef',
          logoIcon: '#7bc67e',
          logoText: '#ffffff',
          logoSubtext: '#7bc67e',
          collapseBtnBg: '#1e1e1e',
          collapseBtnText: '#888888',
          collapseBtnHover: '#7bc67e'
        };
      case 'eye-protection':
        return {
          sidebarBg: '#ddebd0',
          sidebarBorder: '1px solid #d4e6c3',
          sectionLabel: '#8aaa78',
          navText: '#5a7a4a',
          activeBg: '#7bc67e',
          activeText: '#ffffff',
          hoverBg: '#f8faf5',
          newScanBg: '#7bc67e',
          logoRing: '#eef8ef',
          logoIcon: '#7bc67e',
          logoText: '#2d4a1e',
          logoSubtext: '#7bc67e',
          collapseBtnBg: '#f8faf5',
          collapseBtnText: '#5a7a4a',
          collapseBtnHover: '#7bc67e'
        };
      default:
        return {
          sidebarBg: '#ffffff',
          sidebarBorder: 'none',
          sectionLabel: '#9ca3af',
          navText: '#6b7280',
          activeBg: '#7bc67e',
          activeText: '#ffffff',
          hoverBg: 'rgba(240, 253, 244, 1)',
          newScanBg: '#7bc67e',
          logoRing: '#eef8ef',
          logoIcon: '#7bc67e',
          logoText: '#111111',
          logoSubtext: '#7bc67e',
          collapseBtnBg: '#f0fdf4',
          collapseBtnText: '#16a34a',
          collapseBtnHover: '#7bc67e'
        };
    }
  };

  const s = getThemeStyles();

  return (
    <>
      <aside style={{ 
        height: '100vh', 
        width: isCollapsed ? '70px' : '280px', 
        background: s.sidebarBg,
        borderRight: s.sidebarBorder,
        display: 'flex', 
        flexDirection: 'column', 
        zIndex: 100, 
        borderRadius: '0px',
        boxShadow: theme === 'liquid-glass' || theme === 'underwater' ? 'none' : (theme === 'dark' ? 'none' : theme === 'eye-protection' ? '0 2px 12px rgba(100,150,80,0.08)' : '4px 0 24px rgba(0, 0, 0, 0.04)'),
        transition: 'width 0.3s ease',
        overflow: 'hidden',
        overflowY: 'hidden',
        flexShrink: 0,
        backdropFilter: theme === 'liquid-glass' ? 'blur(20px)' : 'none'
      }}>

        {/* Header / Logo Area */}
        <div className={`p-4 flex ${isCollapsed ? 'flex-col gap-4' : 'items-center justify-between'} shrink-0 relative pt-6`}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center shadow-sm" style={{ background: theme === 'underwater' || theme === 'liquid-glass' ? 'rgba(255,255,255,0.05)' : '#eef8ef', border: `1px solid ${s.logoRing}44` }}>
              <Shield size={20} style={{ color: s.logoRing }} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 transition-opacity duration-300">
                <h1 className="text-[14px] font-black uppercase tracking-wider leading-none mb-1 truncate serif" style={{ color: s.logoText }}>Scorpion</h1>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] leading-none truncate mono" style={{ color: s.logoSubtext }}>SecOps Platform</p>
              </div>
            )}
          </div>
          
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center transition-all z-10 border`}
            style={{ 
              background: s.collapseBtnBg,
              borderColor: 'rgba(255,255,255,0.1)',
              color: s.collapseBtnText,
            }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = s.collapseBtnHover; e.currentTarget.style.color = '#ffffff'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = s.collapseBtnBg; e.currentTarget.style.color = s.collapseBtnText; }}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        </div>

        {/* New Scan Button */}
        <div className="px-4 py-2 shrink-0">
          <button 
            onClick={() => setShowScan(true)} 
            className="w-full text-white flex items-center justify-center gap-2 border-none shadow-lg hover:brightness-110 hover:scale-[1.02] active:scale-95 transition-all" 
            style={{ 
              background: s.newScanBg,
              borderRadius: '12px', 
              padding: isCollapsed ? '10px 0' : '12px 16px' 
            }}
          >
            <span className="text-lg font-black leading-none">+</span>
            {!isCollapsed && <span className="text-[11px] font-black uppercase tracking-widest">{t('sidebar.new_scan', 'NEW SCAN')}</span>}
          </button>
          {showScan && <NewScanModal onClose={() => setShowScan(false)} onScan={handleScan} />}
        </div>

        {/* Nav Sections */}
        <div className="flex-1 overflow-hidden px-3 flex flex-col pb-4 mt-2">
          {navSections.map((section, idx) => (
            <div key={idx} className="flex flex-col mb-6">
              {/* Section Header */}
              <div className="px-3" style={{ margin: '8px 0 4px 0' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-center md:text-left transition-all mono" style={{ color: s.sectionLabel }}>
                  {isCollapsed ? section.title.substring(0, 3) : section.title}
                </p>
              </div>
              
              {/* Items */}
              <div className="flex flex-col gap-[2px]">
                {section.items.map(({ icon: Icon, label, path }) => {
                  const active = location.pathname === path;
                  return (
                    <div 
                      key={path}
                      onClick={() => navigate(path)}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px', 
                        padding: isCollapsed ? '8px 0' : '8px 12px', 
                        justifyContent: isCollapsed ? 'center' : 'flex-start',
                        cursor: 'pointer', 
                        background: active ? s.activeBg : 'transparent', 
                        color: active ? s.activeText : s.navText, 
                        border: active && theme === 'liquid-glass' ? s.activeBorder : '1px solid transparent',
                        borderRadius: '10px',
                        transition: 'all 0.2s ease',
                        boxShadow: active && theme !== 'liquid-glass' && theme !== 'underwater' ? '0 4px 12px rgba(123,198,126,0.3)' : 'none',
                        margin: '0 4px',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                      onMouseOver={(e) => { if (!active) e.currentTarget.style.background = s.hoverBg; }}
                      onMouseOut={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {active && theme === 'liquid-glass' && (
                        <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: '3px', background: s.accentBar, borderRadius: '0 4px 4px 0' }} />
                      )}
                      <Icon size={18} style={{ color: active ? s.activeText : 'inherit' }} className="transition-colors" />
                      {!isCollapsed && (
                        <span className={`truncate text-[11px] tracking-widest uppercase ${active ? 'font-bold' : 'font-semibold'}`}>
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

      </aside>
    </>
  );
}

