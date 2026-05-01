import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Bell, Settings, Users, BarChart2, ListTodo, Scale, ChevronLeft, ChevronRight, Layout } from 'lucide-react';
import NewScanModal from './NewScanModal';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import logoImg from '../assets/pre-final_logo-removebg-preview.png';
import toast from 'react-hot-toast';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: ListTodo, label: 'Tasks', path: '/tasks' },
  { icon: BarChart2, label: 'Reports', path: '/reports' },
  { icon: Scale, label: 'Governance', path: '/governance' },
  { icon: Layout, label: 'Repositories', path: '/repos' },
  { icon: Users, label: 'Teams', path: '/teams' },
  { icon: Bell, label: 'Alerts', path: '/alerts' },
];

const settingsItem = { icon: Settings, label: 'Settings', path: '/settings' };

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export default function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showScan, setShowScan] = useState(false);
  const { getJWT } = useAuth();
  const { getLogoFilter, getLogoBlendMode } = useTheme();

  const handleScan = () => {
    setShowScan(false);
  };

  return (
    <div className="shrink-0" style={{ 
      width: isCollapsed ? '60px' : '220px', 
      height: 'fit-content', 
      background: 'var(--bg-primary)', 
      borderRight: '1px solid var(--border-subtle)', 
      display: 'flex', 
      flexDirection: 'column', 
      padding: '24px 0', 
      borderBottom: '1px solid var(--border-subtle)',
      transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      overflowX: 'hidden',
      position: 'relative'
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '4px', 
        padding: isCollapsed ? '0 0 40px 0' : '0 45px 24px 8px', 
        position: 'relative',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        minHeight: '40px'
      }}>
        {!isCollapsed && (
          <>
            <img 
                src={logoImg} 
                alt="Scorpion Logo" 
                style={{ 
                    width: 32, 
                    height: 32, 
                    objectFit: 'contain', 
                    filter: getLogoFilter(), 
                    mixBlendMode: getLogoBlendMode() 
                }} 
            />
            <span style={{ 
              color: 'var(--text-primary)', 
              fontWeight: 800, 
              fontSize: '1.25rem', 
              letterSpacing: '0.05em', 
              fontStyle: 'italic',
              whiteSpace: 'nowrap'
            }}>
              SCORPION
            </span>
          </>
        )}
        
        {/* Toggle Button */}
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsCollapsed(!isCollapsed);
          }}
          style={{
            position: 'absolute',
            top: '50%',
            right: isCollapsed ? 'auto' : '8px',
            left: isCollapsed ? '50%' : 'auto',
            transform: isCollapsed ? 'translate(-50%, -100%)' : 'translateY(-100%)',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px'
          }}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* New Scan Button */}
      <div style={{ padding: isCollapsed ? '0 10px 24px' : '0 16px 24px' }}>
        <button onClick={() => setShowScan(true)} style={{ width: '100%', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '10px', fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.1em', cursor: 'pointer', display: 'flex', justifyContent: 'center' }}>
          {isCollapsed ? '+' : '+ NEW SCAN'}
        </button>
        {showScan && <NewScanModal onClose={() => setShowScan(false)} onScan={handleScan} />}
      </div>

      {/* Nav Items */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
            {navItems.map(({ icon: Icon, label, path }) => {
            const active = location.pathname === path;
            return (
                <div key={path} onClick={() => navigate(path)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: isCollapsed ? '12px 0' : '12px 20px', 
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  cursor: 'pointer', 
                  borderLeft: active ? '3px solid var(--accent-primary)' : '3px solid transparent', 
                  background: active ? 'var(--bg-card)' : 'transparent', 
                  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', 
                  fontSize: '0.85rem', 
                  fontWeight: active ? 700 : 400, 
                  letterSpacing: '0.05em', 
                  transition: 'all 0.15s' 
                }}>
                <Icon size={16} />
                {!isCollapsed && label}
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
                padding: isCollapsed ? '16px 0' : '16px 20px', 
                justifyContent: isCollapsed ? 'center' : 'flex-start',
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
            {!isCollapsed && settingsItem.label}
        </div>
        {!isCollapsed && (
          <div style={{ padding: '12px 20px', color: 'var(--text-secondary)', fontSize: '0.75rem', opacity: 0.5 }}>
            SCORPION V1.0
          </div>
        )}
      </div>
    </div>
  );
}
