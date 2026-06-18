import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { 
  LayoutDashboard, Bell, Settings, Users, BarChart2, ListTodo, Scale, 
  ChevronLeft, ChevronRight, Layout, Clock, Map, 
  TestTube2, Activity, Rocket, Cpu, Shield, GitBranch, Bug, 
  Zap, Package, Tag, Ticket
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

export default function Sidebar({ 
  isCollapsed, 
  setIsCollapsed
}: { 
  isCollapsed: boolean, 
  setIsCollapsed: (c: boolean) => void
}) {
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
        { icon: LayoutDashboard, label: t('sidebar.dashboard'), path: '/' }
      ]
    },
    {
      title: 'PLAN',
      items: [
        { icon: Layout, label: 'PLAN WORKSPACE', path: '/plan' },
        { icon: Ticket, label: 'TICKETS', path: '/tickets' },
        { icon: ListTodo, label: t('sidebar.tasks'), path: '/tasks' },
        { icon: Users, label: t('sidebar.teams'), path: '/teams' }
      ]
    },
    {
      title: 'CODE',
      items: [
        { icon: GitBranch, label: t('sidebar.repositories'), path: '/repos' }
      ]
    },
    {
      title: 'PIPELINES',
      items: [
        { icon: Package, label: 'PIPELINES', path: '/pipelines' }
      ]
    },
    {
      title: 'TEST',
      items: [
        { icon: Cpu, label: 'ANALYZE', path: '/analyze' },
        { icon: Bug, label: 'ISSUES', path: '/issues' },
        { icon: TestTube2, label: 'TEST', path: '/tests' }
      ]
    },
    {
      title: 'RELEASE',
      items: [
        { icon: Tag, label: 'RELEASE', path: '/release' }
      ]
    },
    {
      title: 'DEPLOYMENTS',
      items: [
        { icon: Rocket, label: 'DEPLOYMENTS', path: '/deployments' }
      ]
    },
    {
      title: 'OPERATE',
      items: [
        { icon: Scale, label: t('sidebar.governance'), path: '/governance' },
        { icon: Bell, label: t('sidebar.alerts'), path: '/alerts' },
        { icon: Map, label: 'MAP', path: '/map' }
      ]
    },
    {
      title: 'MONITOR',
      items: [
        { icon: Activity, label: 'MONITOR', path: '/monitor' },
        { 
          icon: BarChart2, 
          label: t('sidebar.reports'), 
          path: '/reports',
          subItems: filteredReports
        },
        { icon: Clock, label: t('sidebar.audit_log'), path: '/audit' }
      ]
    },
    {
      title: 'SYSTEM',
      items: [
        { icon: Settings, label: 'SETTINGS', path: '/settings' }
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
          activeSurfaceBg: 'rgba(0,200,255,0.12)',
          activeText: '#ffffff',
          hoverBg: 'rgba(0,200,255,0.15)',
          newScanBg: 'linear-gradient(135deg, #00a8cc, #0077aa)',
          logoRing: '#00c8ff',
          logoText: '#ffffff',
          logoSubtext: '#00c8ff',
          accentBar: '#00c8ff',
          sectionDivider: 'rgba(0,200,255,0.15)',
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
          activeSurfaceBg: 'rgba(255, 255, 255, 0.18)',
          activeBorder: '1px solid rgba(255, 255, 255, 0.5)',
          activeText: '#ffffff',
          hoverBg: 'rgba(255, 255, 255, 0.15)',
          newScanBg: 'rgba(255, 255, 255, 0.2)',
          logoRing: 'rgba(255, 255, 255, 0.6)',
          logoText: '#ffffff',
          logoSubtext: 'rgba(255, 255, 255, 0.7)',
          accentBar: 'rgba(255, 255, 255, 0.8)',
          sectionDivider: 'rgba(255, 255, 255, 0.12)',
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
          activeSurfaceBg: 'rgba(0, 255, 65, 0.10)',
          activeBorder: '1px solid #00ff41',
          activeText: '#00ff41',
          hoverBg: 'rgba(0, 59, 0, 0.3)',
          newScanBg: '#008f11',
          logoRing: '#00ff41',
          logoText: '#00ff41',
          logoSubtext: '#008f11',
          accentBar: '#00ff41',
          sectionDivider: '#003b00',
          collapseBtnBg: '#001100',
          collapseBtnText: '#008f11',
          collapseBtnHover: '#00ff41'
        };
      case 'dark':
        return {
          sidebarBg: '#18181b', // neutral-900
          sidebarBorder: '1px solid #27272a', // neutral-800
          sectionLabel: '#71717a', // neutral-500
          navText: '#a1a1aa', // neutral-400
          activeBg: '#6db87a',
          activeSurfaceBg: 'rgba(109,184,122,0.12)',
          activeText: '#ffffff',
          hoverBg: '#27272a', // neutral-800
          newScanBg: '#6db87a',
          logoRing: '#eef8ef',
          logoIcon: '#6db87a',
          logoText: '#f4f4f5', // neutral-100
          logoSubtext: '#6db87a',
          accentBar: '#6db87a',
          sectionDivider: '#27272a', // neutral-800
          collapseBtnBg: '#27272a', // neutral-800
          collapseBtnText: '#a1a1aa', // neutral-400
          collapseBtnHover: '#6db87a'
        };
      case 'eye-protection':
        return {
          sidebarBg: '#ddebd0',
          sidebarBorder: '1px solid #d4e6c3',
          sectionLabel: '#8aaa78',
          navText: '#5a7a4a',
          activeBg: '#6db87a',
          activeSurfaceBg: 'rgba(109,184,122,0.12)',
          activeText: '#ffffff',
          hoverBg: '#f8faf5',
          newScanBg: '#6db87a',
          logoRing: '#eef8ef',
          logoIcon: '#6db87a',
          logoText: '#2d4a1e',
          logoSubtext: '#6db87a',
          accentBar: '#6db87a',
          sectionDivider: '#d4e6c3',
          collapseBtnBg: '#f8faf5',
          collapseBtnText: '#5a7a4a',
          collapseBtnHover: '#6db87a'
        };
      default:
        return {
          sidebarBg: '#ffffff',
          sidebarBorder: 'none',
          sectionLabel: '#9ca3af',
          navText: '#6b7280',
          activeBg: '#6db87a',
          activeSurfaceBg: 'rgba(109,184,122,0.10)',
          activeText: '#ffffff',
          hoverBg: 'rgba(240, 253, 244, 1)',
          newScanBg: '#6db87a',
          logoRing: '#eef8ef',
          logoIcon: '#6db87a',
          logoText: '#111111',
          logoSubtext: '#6db87a',
          accentBar: '#6db87a',
          sectionDivider: '#e5e7eb',
          collapseBtnBg: '#f0fdf4',
          collapseBtnText: '#16a34a',
          collapseBtnHover: '#6db87a'
        };
    }
  };

  const s = getThemeStyles();

  return (
    <>
      <aside style={{ 
        height: '100vh', 
        width: isCollapsed ? '64px' : '200px', 
        background: s.sidebarBg,
        borderRight: s.sidebarBorder,
        display: 'flex', 
        flexDirection: 'column', 
        zIndex: 100, 
        borderRadius: '0px',
        boxShadow: theme === 'liquid-glass' || theme === 'underwater' ? 'none' : (theme === 'dark' ? 'none' : theme === 'eye-protection' ? '0 2px 12px rgba(100,150,80,0.08)' : '4px 0 24px rgba(0, 0, 0, 0.04)'),
        transition: 'width 0.3s ease',
        overflow: 'hidden',
        overflowY: 'auto',
        flexShrink: 0,
        backdropFilter: theme === 'liquid-glass' ? 'blur(20px)' : 'none'
      }}>

        {/* Header / Logo Area */}
        <div className={`flex ${isCollapsed ? 'flex-col items-center gap-3 px-0 pb-3 pt-5' : 'px-3 py-3 items-center justify-between'} shrink-0 relative border-b`}
          style={{ borderColor: s.sidebarBorder !== 'none' ? 'rgba(255,255,255,0.06)' : 'transparent' }}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center w-full' : 'gap-2'}`}>
            <div className={`flex items-center justify-center rounded-lg transition-all ${isCollapsed ? 'w-9 h-9' : 'w-6 h-6'}`}
               style={{ background: s.newScanBg, color: 'white' }}>
              <Shield size={isCollapsed ? 18 : 13} strokeWidth={3} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <h1 className="text-[11px] font-black tracking-tighter leading-none italic" style={{ color: s.logoText || s.navText }}>SCORPION</h1>
                <span className="text-[7px] font-bold tracking-[0.2em] uppercase opacity-60" style={{ color: s.logoSubtext || s.navText }}>SECops Platform</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center transition-all z-10 border ${isCollapsed ? 'mx-auto' : ''}`}
            style={{
              background: s.collapseBtnBg,
              borderColor: 'rgba(255,255,255,0.1)',
              color: s.collapseBtnText,
            }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = s.collapseBtnHover; e.currentTarget.style.color = '#ffffff'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = s.collapseBtnBg; e.currentTarget.style.color = s.collapseBtnText; }}
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
          </button>
        </div>


        {/* Nav Sections */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isCollapsed ? 'px-0' : 'px-2.5'} flex flex-col pb-5 mt-1`}>
          {navSections.map((section, idx) => (
            <div
              key={idx}
              className={`flex flex-col mb-1 ${idx > 0 ? (isCollapsed ? 'pt-2 mt-1' : 'pt-3 mt-2') : ''}`}
              style={idx > 0 ? { borderTop: `1px solid ${s.sectionDivider || s.sidebarBorder}` } : undefined}
            >
              {/* Section Header */}
              {!isCollapsed && (
                <div className="px-2 mb-0.5">
                  <p className="text-[7px] font-bold uppercase tracking-widest text-left transition-all mono" style={{ color: s.sectionLabel }}>
                    {section.title}
                  </p>
                </div>
              )}

              {/* Items */}
              <div className={`flex flex-col ${isCollapsed ? 'gap-0' : 'gap-[1px]'}`}>
                {section.items.map((item) => {
                  const { icon: Icon, label, path } = item as any;
                  const active = path === '/plan' ? location.pathname.startsWith('/plan') : (path === '/tickets' ? (location.pathname.startsWith('/tickets') || location.pathname === '/jira-settings') : location.pathname === path);
                  const tourId =
                    path === '/' ? 'tour-dashboard' :
                    path === '/repos' ? 'tour-repos' :
                    path === '/tasks' ? 'tour-tasks' :
                    path === '/alerts' ? 'tour-alerts' :
                    path === '/release' ? 'tour-release' :
                    path === '/settings' ? 'tour-settings' : undefined;

                  return (
                    <div key={path} className="flex flex-col">
                      <Link
                        to={path}
                        id={tourId}
                        className={isCollapsed
                          ? `flex items-center justify-center transition-colors relative w-full h-[38px] border-l-[3px] ${active ? 'border-l-[var(--sidebar-accent)]' : 'border-l-transparent'}`
                          : `flex items-center gap-2 px-2.5 py-1.5 rounded-lg border-l-[3px] transition-colors relative group/item ${active ? 'border-l-[var(--sidebar-accent)]' : 'border-l-transparent'}`
                        }
                        style={{
                          margin: isCollapsed ? '0' : '0 2px',
                          position: 'relative',
                          overflow: 'hidden',
                          background: active ? s.activeSurfaceBg : 'transparent',
                          ['--sidebar-accent' as any]: s.accentBar || s.activeBg,
                        }}
                        onMouseOver={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = s.hoverBg;
                          }
                        }}
                        onMouseOut={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        <Icon
                          size={isCollapsed ? 18 : 14}
                          style={{
                            color: active ? (s.accentBar || s.activeBg) : s.navText,
                            margin: isCollapsed ? '0 auto' : '0'
                          }}
                          className="transition-colors shrink-0"
                        />
                        {!isCollapsed && (
                          <span
                            className={`truncate text-[10px] tracking-wide uppercase ${active ? 'font-bold' : 'font-medium'}`}
                            style={{ color: active ? (s.logoText || s.navText) : s.navText }}
                          >
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
