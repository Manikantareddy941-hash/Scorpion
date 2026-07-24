import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, Bell, Settings, Users, BarChart2, ListTodo, Scale,
  ChevronLeft, ChevronRight, Layout, Clock, Map,
  TestTube2, Activity, Rocket, Cpu, Shield, GitBranch, Bug,
  Zap, Package, Tag, Ticket, ShieldCheck, Boxes
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
  const {} = useTheme();
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
        { icon: ShieldCheck, label: 'SECURITY OVERVIEW', path: '/overview' }
      ]
    },
    {
      title: 'PLAN',
      items: [
        { icon: Layout, label: 'PLAN WORKSPACE', path: '/plan' },
        { icon: ShieldCheck, label: 'SECURITY REQUIREMENTS', path: '/requirements' },
        { icon: Shield, label: 'POLICY BUILDER', path: '/policy-builder' },
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
        { icon: Rocket, label: 'DEPLOYMENTS', path: '/deployments' },
        { icon: Boxes, label: 'INFRASTRUCTURE (IAC)', path: '/iac' }
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

  const s = {
    sidebarBg: 'var(--bg-card)',
    sidebarBorder: '1px solid var(--border-subtle)',
    sectionLabel: 'var(--text-muted)',
    navText: 'var(--text-secondary)',
    activeBg: 'color-mix(in srgb, var(--accent-primary) 9%, transparent)',
    activeText: 'var(--accent-primary)',
    hoverBg: 'var(--bg-secondary)',
    newScanBg: 'var(--accent-primary)',
    logoRing: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
    logoIcon: 'var(--accent-primary)',
    logoText: 'var(--text-primary)',
    logoSubtext: 'var(--text-secondary)',
    collapseBtnBg: 'var(--bg-secondary)',
    collapseBtnText: 'var(--text-secondary)',
    collapseBtnHover: 'var(--accent-primary)',
    collapsedActiveBg: 'color-mix(in srgb, var(--accent-primary) 9%, transparent)',
    collapsedActiveBorder: 'var(--accent-primary)',
    collapsedHoverBg: 'var(--bg-secondary)',
    collapsedActiveIconColor: 'var(--accent-primary)'
  };

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
        overflow: 'hidden',
        overflowY: 'auto',
        flexShrink: 0 }}>

        {/* Header / Logo Area */}
        <div className={`flex ${isCollapsed ? 'flex-col gap-4 items-center px-0 pt-6 pb-4' : 'justify-between items-center p-4'} shrink-0 relative`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center w-full' : 'gap-2'}`}>
            <div className={`flex items-center justify-center rounded-lg transition-all ${isCollapsed ? 'w-10 h-10' : 'w-7 h-7'}`}
               style={{ background: s.newScanBg, color: 'white' }}>
              <Shield size={isCollapsed ? 20 : 14} strokeWidth={3} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <h1 className="text-[13px] font-semibold tracking-tight leading-none" style={{ color: s.logoText || s.navText }}>Scorpion</h1>
                <span className="text-[9px] font-medium tracking-[0.08em] uppercase opacity-60" style={{ color: s.logoSubtext || s.navText }}>SecOps Platform</span>
              </div>
            )}
          </div>
          
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center transition-all z-10 border ${isCollapsed ? 'mx-auto' : ''}`}
            style={{ 
              background: s.collapseBtnBg,
              borderColor: 'rgba(255,255,255,0.1)',
              color: s.collapseBtnText }}
            onMouseOver={(e) => { e.currentTarget.style.backgroundColor = s.collapseBtnHover; e.currentTarget.style.color = '#ffffff'; }}
            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = s.collapseBtnBg; e.currentTarget.style.color = s.collapseBtnText; }}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        </div>


        {/* Nav Sections */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isCollapsed ? 'px-0' : 'px-3'} flex flex-col pb-6 mt-2`}>
          {navSections.map((section, idx) => (
            <div key={idx} className="flex flex-col mb-2.5">
              {/* Section Header */}
              {!isCollapsed && (
                <div className="px-3 mb-1">
                  <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: s.sectionLabel }}>
                    {section.title}
                  </p>
                </div>
              )}
              
              {/* Items */}
              <div className={`flex flex-col ${isCollapsed ? 'gap-0' : 'gap-1'}`}>
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

                  // Convert label from translation keys or all-caps if translation is missing
                  let displayLabel = label;
                  if (typeof label === 'string') {
                    // Try to capitalize nicely (sentence casing)
                    displayLabel = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
                  }

                  return (
                    <div key={path} className="flex flex-col">
                      <Link
                        to={path}
                        id={tourId}
                        className={isCollapsed
                          ? `flex items-center justify-center transition-all relative w-full h-[40px] ${active ? 'opacity-100 border-l-[3px]' : 'opacity-75 hover:opacity-100 border-l-[3px] border-l-transparent'}`
                          : `flex items-center gap-3 px-3 h-8.5 py-1.5 rounded-lg transition-all relative group/item ${active ? 'opacity-100 font-medium' : 'opacity-80 hover:translate-x-1'}`
                        }
                        style={{
                          transition: 'all 0.15s ease',
                          margin: isCollapsed ? '0' : '0 4px',
                          position: 'relative',
                          overflow: 'hidden',
                          backgroundColor: isCollapsed
                            ? (active ? s.collapsedActiveBg : 'transparent')
                            : (active ? s.activeBg : 'transparent'),
                          borderLeftColor: isCollapsed ? (active ? s.collapsedActiveBorder : 'transparent') : undefined }}
                      >
                        <Icon
                          size={16}
                          style={{
                            color: active ? (isCollapsed ? s.collapsedActiveIconColor : s.activeText) : s.navText,
                            margin: isCollapsed ? '0 auto' : '0'
                          }}
                          className="transition-colors shrink-0"
                        />
                        {!isCollapsed && (
                          <span
                            className={`flex-1 min-w-0 truncate text-xs ${active ? 'font-semibold' : 'font-normal'}`}
                            style={{ color: active ? s.activeText : s.navText }}
                          >
                            {displayLabel}
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
