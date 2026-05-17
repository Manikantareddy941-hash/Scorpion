import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { 
  LayoutDashboard, Bell, Settings, Users, BarChart2, ListTodo, Scale, 
  ChevronLeft, ChevronRight, Layout, Clock, Map, 
  TestTube2, Activity, Rocket, Cpu, Shield, GitBranch, Bug, 
  Zap
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

export default function Sidebar({ isCollapsed, setIsCollapsed }: { isCollapsed: boolean, setIsCollapsed: (c: boolean) => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { theme } = useTheme();
  const [searchQuery] = useState('');

  // Keyboard Shortcut: Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('report-search-input');
        input?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const reportItems = [
    { id: 'infra', icon: Activity, label: 'Infrastructure', path: '/reports/infra' },
    { id: 'security', icon: Shield, label: 'Security Audit', path: '/reports/security' },
    { id: 'ai-summary', icon: Zap, label: 'AI Security Briefing', path: '/reports/ai-summary' },
    { id: 'compliance', icon: Scale, label: 'Compliance Audit', path: '/reports/compliance', requiredRole: 'admin' },
  ];

  const filteredReports = reportItems.filter(item => 
    item.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const navSections = [
    {
      title: 'OVERVIEW',
      items: [
        { icon: LayoutDashboard, label: t('sidebar.dashboard'), path: '/' },
        { 
          icon: BarChart2, 
          label: t('sidebar.reports'), 
          path: '/reports',
          subItems: filteredReports
        },
        { icon: Activity, label: 'MONITOR', path: '/monitor' },
      ]
    },
    {
      title: 'DEVELOP',
      items: [
        { icon: GitBranch, label: t('sidebar.repositories'), path: '/repos' },
        { icon: ListTodo, label: t('sidebar.tasks'), path: '/tasks' },
      ]
    },
    {
      title: 'SECURE',
      items: [
        { icon: Cpu, label: 'ANALYZE', path: '/analyze' },
        { icon: Bug, label: 'ISSUES', path: '/issues' },
        { icon: TestTube2, label: 'TEST', path: '/tests' },
      ]
    },
    {
      title: 'OPERATE',
      items: [
        { icon: Rocket, label: 'RELEASE', path: '/release' },
        { icon: Scale, label: t('sidebar.governance'), path: '/governance' },
        { icon: Map, label: 'MAP', path: '/map' },
      ]
    },
    {
      title: 'SYSTEM',
      items: [
        { icon: Bell, label: t('sidebar.alerts'), path: '/alerts' },
        { icon: Clock, label: t('sidebar.audit_log'), path: '/audit' },
        { icon: Users, label: t('sidebar.teams'), path: '/teams' },
        { icon: Settings, label: 'SETTINGS', path: '/settings' },
      ]
    }
  ];

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
        width: isCollapsed ? '60px' : '200px', 
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
          <div className="flex items-center gap-2">
            <div className={`flex items-center justify-center rounded-lg transition-all ${isCollapsed ? 'w-10 h-10' : 'w-7 h-7'}`}
              style={{ background: s.newScanBg, color: 'white' }}>
              <Shield size={isCollapsed ? 20 : 14} strokeWidth={3} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <h1 className="text-[12px] font-black tracking-tighter leading-none italic" style={{ color: s.logoText || s.navText }}>SCORPION</h1>
                <span className="text-[7px] font-bold tracking-[0.2em] uppercase opacity-60" style={{ color: s.logoSubtext || s.navText }}>SECops Platform</span>
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

        {/* Nav Sections */}
        <div className="flex-1 overflow-hidden px-3 flex flex-col pb-4 mt-2">
          {navSections.map((section, idx) => (
            <div key={idx} className="flex flex-col mb-4">
              {/* Section Header */}
              <div className="px-2" style={{ margin: '2px 0 2px 0' }}>
                <p className="text-[7px] font-bold uppercase tracking-widest text-center md:text-left transition-all mono" style={{ color: s.sectionLabel }}>
                  {isCollapsed ? section.title.substring(0, 1) : section.title}
                </p>
              </div>
              
              {/* Items */}
              <div className="flex flex-col gap-[2px]">
                {section.items.map((item) => {
                  const { icon: Icon, label, path } = item as any;
                  const active = location.pathname === path;
                  return (
                    <div key={path} className="flex flex-col">
                      <Link
                        to={path}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all relative group/item ${active ? 'opacity-100' : 'opacity-70 hover:opacity-100 hover:bg-[rgba(123,198,126,0.1)]'}`}
                      style={{ 
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
                      <Icon size={16} style={{ color: active ? s.activeText : 'inherit' }} className="transition-colors" />
                      {!isCollapsed && (
                        <span className={`truncate text-[10px] tracking-widest uppercase ${active ? 'font-bold' : 'font-semibold'}`}>
                          {label}
                        </span>
                      )}
                    </Link>

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

