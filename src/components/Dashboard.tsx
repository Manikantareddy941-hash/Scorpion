import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  LogOut, Shield, Settings, ChevronDown, Activity, Users, ListTodo, AlertCircle,
  BarChart3, Sun, Moon, Bug, Wind, Target, Eye, Snowflake
} from 'lucide-react';
import { Theme } from '../contexts/ThemeContext';

import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

const defaultThreatData = [
  { axis: 'Vulnerabilities', Observed: 60, Expected: 90 },
  { axis: 'Bugs', Observed: 45, Expected: 80 },
  { axis: 'Security Issues', Observed: 70, Expected: 85 },
  { axis: 'Code Smells', Observed: 55, Expected: 75 },
  { axis: 'Coverage', Observed: 80, Expected: 90 },
  { axis: 'Duplications', Observed: 40, Expected: 70 },
];

const threatData = [
  { axis: 'Vulnerabilities', Observed: 85, Expected: 90 },
  { axis: 'Bugs', Observed: 60, Expected: 80 },
  { axis: 'Security', Observed: 70, Expected: 85 },
  { axis: 'Code Smells', Observed: 50, Expected: 85 },
  { axis: 'Coverage', Observed: 75, Expected: 80 },
  { axis: 'Duplications', Observed: 65, Expected: 70 },
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { theme, setTheme, getLogoFilter } = useTheme();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [latestScan, setLatestScan] = useState<any | null>(null);

  useEffect(() => {
    const init = async () => {
      await fetchLatestScan();
      setLoading(false);
    };
    init();
  }, []);

  const fetchLatestScan = async () => {
    try {
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.equal('status', 'completed'),
        Query.orderDesc('timestamp'),
        Query.limit(1)
      ]);
      
      if (response.documents.length > 0) {
        setLatestScan(response.documents[0]);
      }
    } catch (error) {
      console.error('Error fetching latest scan:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <img src={logoImg} alt="Scorpion Logo" className="w-16 h-16 object-contain animate-pulse" style={{ filter: getLogoFilter(), mixBlendMode: 'multiply' }} />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">Initializing Scorpion Protocols...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col transition-colors duration-300">
      <nav className="bg-[var(--bg-primary)] backdrop-blur-md shadow-sm border-b border-[var(--border-subtle)] sticky top-0 z-40 text-[var(--text-primary)]">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  onClick={() => setIsThemeOpen(!isThemeOpen)}
                  className="p-2 hover:bg-white/5 rounded-xl transition-all text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-subtle)] flex items-center gap-2"
                >
                  {theme === 'light' && <Sun className="w-5 h-5" />}
                  {theme === 'dark' && <Moon className="w-5 h-5" />}
                  {theme === 'eye-protection' && <Eye className="w-5 h-5" />}
                  {(theme === 'snow-light' || theme === 'snow-dark') && <Snowflake className="w-5 h-5" />}
                  <ChevronDown className={`w-3 h-3 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`} />
                </button>

                {isThemeOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsThemeOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-2 z-50 animate-in fade-in zoom-in duration-200">
                      {[
                        { id: 'light', label: 'Light Mode', icon: Sun },
                        { id: 'dark', label: 'Dark Mode', icon: Moon },
                        { id: 'eye-protection', label: 'Eye Protection', icon: Eye },
                        { id: 'snow-light', label: 'Snow Light', icon: Snowflake },
                        { id: 'snow-dark', label: 'Snow Dark', icon: Snowflake },
                      ].map((t) => (
                        <button
                          key={t.id}
                          onClick={() => { setTheme(t.id as Theme); setIsThemeOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-colors
                            ${theme === t.id ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'}`}
                        >
                          <t.icon className="w-4 h-4" />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setIsNavOpen(!isNavOpen)}
                  className="flex items-center gap-3 p-1.5 hover:bg-white/5 rounded-xl transition border border-transparent hover:border-[#1E1E1E]"
                >
                  <div onClick={(e) => { e.stopPropagation(); navigate('/profile'); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'inherit' }}>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-bold text-[var(--text-primary)] leading-none mb-1">
                        {user?.email?.split('@')[0]}
                      </p>
                      <p className="text-[9px] text-[var(--text-secondary)] font-bold uppercase tracking-widest leading-none italic">
                        Security Lead
                      </p>
                    </div>
                    <div className="w-8 h-8 bg-[var(--accent-primary)] rounded-lg flex items-center justify-center text-white font-black text-xs shadow-lg shadow-[var(--accent-primary)]/20">
                      {user?.email?.[0].toUpperCase()}
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                </button>

                {isNavOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-secondary)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-3 z-50 animate-in fade-in zoom-in duration-200">
                      <div className="px-4 py-3 border-b border-[var(--border-subtle)] mb-2">
                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Signed in as</p>
                        <p className="text-xs font-bold text-[var(--text-primary)] truncate">{user?.email}</p>
                      </div>

                      <div className="space-y-1">
                        {[
                          { to: '/tasks', icon: ListTodo, label: 'Tasks' },
                          { to: '/reports', icon: BarChart3, label: 'Reports & Export' },
                          { to: '/teams', icon: Users, label: 'Team Members' },
                          { to: '/settings', icon: Settings, label: 'Global Settings' },
                        ].map((link) => (
                          <div
                            key={link.to}
                            onClick={() => { navigate(link.to); setIsNavOpen(false); }}
                            className="flex items-center gap-3 px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)] transition italic uppercase tracking-tight cursor-pointer"
                          >
                            <link.icon className="w-4 h-4" />
                            {link.label}
                          </div>
                        ))}
                      </div>

                      <div className="h-px bg-[var(--border-subtle)] my-2" />
                      <button
                        onClick={() => { signOut(); setIsNavOpen(false); }}
                        className="flex items-center gap-3 w-full px-4 py-2 text-xs font-black text-[var(--status-error)] hover:bg-[var(--status-error)]/5 transition italic uppercase tracking-tighter"
                      >
                        <LogOut className="w-4 h-4" />
                        Terminate Session
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 flex-grow overflow-x-hidden">
        {/* Security Intelligence Pulse Section - Horizontal Rectangular Design */}
        <div className="mb-12 w-full">
          <div className="p-6 relative overflow-hidden group w-full min-h-[400px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '24px' }}>
            <div className="absolute -right-20 -top-20 w-64 h-64 bg-[var(--accent-primary)]/5 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-[var(--accent-primary)]/10 rounded-xl text-[var(--accent-primary)]">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase tracking-widest italic text-[var(--text-primary)]">Security Pulse</h2>
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-0.5">Real-time Vector Analysis</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-[var(--status-success)]/10 text-[var(--status-success)] rounded-full border border-[var(--status-success)]/20">
                  <div className="w-1 h-1 bg-[var(--status-success)] rounded-full animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest italic">+12%</span>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row gap-6 w-full min-h-[350px]">
                {/* LEFT: Radar Chart */}
                <div className="w-full lg:w-4/12 min-h-[500px] bg-black/5 dark:bg-white/5 rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-inner flex items-center justify-center relative z-20 p-4">
                  <ResponsiveContainer width="100%" height={500}>
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={(!threatData || threatData.length === 0 || threatData.every(d => d.Observed === 0)) ? defaultThreatData : threatData}>
                      <PolarGrid 
                        gridType="polygon" 
                        stroke="var(--text-secondary)" 
                        strokeOpacity={0.8} 
                        strokeWidth={1}
                      />
                      <PolarAngleAxis 
                        dataKey="axis" 
                        tick={{ 
                          fill: 'var(--text-primary)', 
                          fontSize: 10, 
                          fontWeight: 900,
                          textAnchor: 'middle' 
                        }} 
                      />
                      <PolarRadiusAxis 
                        angle={30} 
                        domain={[0, 100]} 
                        axisLine={true}
                        stroke="var(--border-subtle)"
                        strokeOpacity={0.5}
                        tick={false} 
                      />
                      
                      {/* Manual Radius Labels - Positioned to the side */}
                      {[
                        { r: 25, label: 'Minimum' },
                        { r: 50, label: 'Modest' },
                        { r: 75, label: 'Large' },
                        { r: 100, label: 'Maximum' }
                      ].map((ring) => (
                        <text
                          key={ring.label}
                          x="55%"
                          y={`${50 - (ring.r * 0.35)}%`} // Offset calculation
                          textAnchor="start"
                          fill="var(--text-secondary)"
                          fontSize="7"
                          fontWeight="900"
                          className="uppercase tracking-[0.2em] opacity-60"
                        >
                          {ring.label}
                        </text>
                      ))}

                      <Tooltip 
                        contentStyle={{ 
                          background: 'var(--bg-card)', 
                          border: '1px solid var(--accent-primary)', 
                          borderRadius: '12px', 
                          color: 'var(--text-primary)', 
                          fontSize: '9px', 
                          textTransform: 'uppercase', 
                          fontWeight: 'bold' 
                        }}
                        itemStyle={{ color: 'var(--accent-primary)' }}
                      />
                      <Radar
                        name="Observed"
                        dataKey="Observed"
                        stroke="var(--accent-primary)"
                        strokeWidth={2}
                        fill="var(--accent-primary)"
                        fillOpacity={0.4}
                        dot={{ r: 4, fill: 'var(--accent-primary)', fillOpacity: 1, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                      />
                      <Radar
                        name="Expected"
                        dataKey="Expected"
                        stroke="var(--text-secondary)"
                        strokeWidth={1}
                        fill="var(--text-secondary)"
                        fillOpacity={0.05}
                        strokeDasharray="4 4"
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* RIGHT: Metric Grid */}
                 <div className="w-full lg:w-8/12 grid grid-cols-2 lg:grid-cols-4 gap-4 min-h-[400px]">
                {[
                  { 
                    label: 'Critical', 
                    value: latestScan ? latestScan.criticalCount : '00', 
                    status: (latestScan?.criticalCount > 0) ? 'THREAT DETECTED' : 'SECURE', 
                    color: (latestScan?.criticalCount > 0) ? 'text-[var(--status-error)]' : 'text-[var(--text-secondary)]', 
                    icon: Shield 
                  },
                  { 
                    label: 'High Risk', 
                    value: latestScan ? latestScan.highCount : '00', 
                    status: (latestScan?.highCount > 0) ? 'REQUIRES REVIEW' : 'WITHIN LIMITS', 
                    color: (latestScan?.highCount > 0) ? 'text-[var(--status-error)]' : 'text-[var(--status-success)]', 
                    icon: AlertCircle 
                  },
                  { 
                    label: 'Medium Risk', 
                    value: latestScan ? latestScan.mediumCount : '00', 
                    status: (latestScan?.mediumCount > 0) ? 'MONITORING' : 'SECURE', 
                    color: 'text-[var(--status-warning)]', 
                    icon: Bug 
                  },
                  { 
                    label: 'Low Risk', 
                    value: latestScan ? latestScan.lowCount : '00', 
                    status: 'WITHIN LIMITS', 
                    color: 'text-[var(--text-secondary)]', 
                    icon: Wind 
                  },
                  { 
                    label: 'Bugs', 
                    value: latestScan?.bugCount ?? 0, 
                    status: (latestScan?.bugCount > 0) ? 'RECOVERY NEEDED' : 'SECURE', 
                    color: 'text-[var(--status-warning)]', 
                    icon: Bug 
                  },
                  { 
                    label: 'Vulnerabilities', 
                    value: latestScan ? (latestScan.criticalCount + latestScan.highCount + latestScan.mediumCount + latestScan.lowCount) : 0, 
                    status: (latestScan?.criticalCount + latestScan?.highCount > 0) ? 'THREAT VECTOR' : 'SECURE', 
                    color: 'text-[var(--status-error)]', 
                    icon: Shield 
                  },
                  { 
                    label: 'Code Smells', 
                    value: latestScan?.codeSmellCount ?? 0, 
                    status: (latestScan?.codeSmellCount > 20) ? 'REVIEW ADVISE' : 'CLEAN', 
                    color: 'text-[var(--accent-primary)]', 
                    icon: Target 
                  },
                ].map((item) => (
                  <div 
                    key={item.label} 
                    className="p-5 relative group/card border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 transition-all duration-300 min-h-[140px] flex flex-col justify-between overflow-hidden premium-card" 
                  >
                    <div className="flex justify-between items-start mb-2">
                       <div className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-wider italic">{item.label}</div>
                       <item.icon className={`w-4 h-4 ${item.color} opacity-60 group-hover/card:scale-110 transition-transform`} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-3xl font-black italic tracking-tighter text-[var(--text-primary)] leading-none">{item.value}</div>
                      <div className={`text-[9px] font-black uppercase tracking-widest italic ${item.color}`}>{item.status}</div>
                    </div>
                    <div className="w-full h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden mt-4">
                      <div 
                        className={`h-full bg-[var(--accent-primary)]`} 
                        style={{ width: `${Math.random() * 60 + 20}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
);
}
