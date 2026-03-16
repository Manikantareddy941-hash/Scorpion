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
          );
        })}
      </nav>

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
