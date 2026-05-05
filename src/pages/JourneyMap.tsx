import React, { useEffect, useState } from 'react';
import { 
  GitBranch, Code2, Hammer, FlaskConical, Radar, SearchCode, Filter, UserCheck, 
  Wrench, ShieldCheck, FileText, Activity, Scale, Rocket,
  Settings2, LayoutList, ClipboardList,
  Bug, Trophy, CheckSquare, Users, RefreshCw
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export default function JourneyMap() {
  const { theme } = useTheme();
  const [stats, setStats] = useState({
    repos: 0,
    scans: 0,
    openVulns: 0,
    resolvedVulns: 0,
    verifiedVulns: 0,
    tasks: 0,
    reports: 0,
    recentlyMonitored: false,
    lastScanDate: 'N/A'
  });

  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchJourney = async () => {
      try {
        const [reposRes, scansRes, vulnsRes, tasksRes, reportsRes] = await Promise.all([
          databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.limit(0)]).catch(() => ({ total: 0 })),
          databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [Query.limit(0)]).catch(() => ({ total: 0 })),
          databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [Query.limit(0)]).catch(() => ({ total: 0 })),
          databases.listDocuments(DB_ID, COLLECTIONS.TASKS, [Query.limit(0)]).catch(() => ({ total: 0 })),
          databases.listDocuments(DB_ID, COLLECTIONS.REPORTS || 'reports', [Query.limit(0)]).catch(() => ({ total: 0 })),
        ]);

        let resolved = 0;
        try {
          const resolvedRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
             Query.equal('status', ['fixed', 'resolved', 'verified']),
             Query.limit(0)
          ]);
          resolved = resolvedRes.total;
        } catch (e) {
          resolved = 0;
        }

        let verified = 0;
        try {
          const verifiedRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
             Query.equal('verified', true),
             Query.limit(0)
          ]);
          verified = verifiedRes.total;
        } catch (e) {
          verified = 0;
        }

        let recentlyMonitored = false;
        try {
          const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const recentScans = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.greaterThan('$createdAt', last24h),
            Query.limit(1)
          ]);
          recentlyMonitored = recentScans.total > 0;
        } catch (e) {
          recentlyMonitored = false;
        }

        let lastScanDate = 'N/A';
        try {
          const latestScan = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.orderDesc('$createdAt'),
            Query.limit(1)
          ]);
          if (latestScan.documents.length > 0) {
            lastScanDate = new Date(latestScan.documents[0].$createdAt).toLocaleString();
          }
        } catch (e) {}

        setStats({
          repos: reposRes.total,
          scans: scansRes.total,
          openVulns: Math.max(0, vulnsRes.total - resolved),
          resolvedVulns: resolved,
          verifiedVulns: verified,
          tasks: tasksRes.total,
          reports: reportsRes.total,
          recentlyMonitored,
          lastScanDate
        });
      } catch (err) {
        console.error("Failed to fetch journey stats", err);
      } finally {
        setLoading(false);
      }
    };
    fetchJourney();
  }, []);

  const nodes = [
    { id: 1, name: 'Connect Repo', icon: GitBranch, color: '#3b82f6', path: '/repos', status: stats.repos > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 2, name: 'Configure Scan', icon: Settings2, color: '#6366f1', path: '/repos', status: stats.repos > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 3, name: 'Run Scan', icon: Radar, color: '#8b5cf6', path: '/scan-results', status: stats.scans > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 4, name: 'View Results', icon: LayoutList, color: '#a855f7', path: '/scan-results', status: stats.scans > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 5, name: 'Analyze Risk', icon: SearchCode, color: '#f97316', path: '/insights', status: stats.scans > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 6, name: 'Triage Vulns', icon: Filter, color: '#f59e0b', path: '/scan-results', status: stats.scans > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 7, name: 'Assign Tasks', icon: UserCheck, color: '#ef4444', path: '/tasks', status: stats.scans > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 8, name: 'Remediate', icon: Wrench, color: '#f43f5e', path: '/tasks', status: stats.tasks > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 9, name: 'Verify Fix', icon: ShieldCheck, color: '#ec4899', path: '/scan-results', status: stats.tasks > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 10, name: 'Monitor Fleet', icon: Activity, color: '#22c55e', path: '/monitor', status: stats.resolvedVulns > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 11, name: 'Generate Report', icon: FileText, color: '#14b8a6', path: '/reports', status: stats.reports > 0 ? 'COMPLETE' : 'PENDING' },
    { id: 12, name: 'Audit Trail', icon: ClipboardList, color: '#06b6d4', path: '/audit', status: stats.recentlyMonitored ? 'COMPLETE' : 'PENDING' },
    { id: 13, name: 'Govern Policy', icon: Scale, color: '#6366f1', path: '/governance', status: 'PENDING' },
    { id: 14, name: 'Release Gate', icon: Rocket, color: '#fbbf24', path: '/release', status: 'PENDING' }
  ];

  // Logic to set "IN PROGRESS"
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].status === 'PENDING') {
      if (i === 0 || nodes[i-1].status === 'COMPLETE') {
        nodes[i].status = 'IN PROGRESS';
        break;
      }
    }
  }

  const completedCount = nodes.filter(n => n.status === 'COMPLETE').length;

  // Winding coordinates for 14 nodes
  const coords = [
    { x: 100, y: 350 }, { x: 250, y: 250 }, { x: 450, y: 180 }, { x: 650, y: 220 },
    { x: 800, y: 350 }, { x: 950, y: 500 }, { x: 1150, y: 600 }, { x: 1400, y: 550 },
    { x: 1600, y: 400 }, { x: 1800, y: 250 }, { x: 2050, y: 220 }, { x: 2300, y: 350 },
    { x: 2500, y: 550 }, { x: 2750, y: 450 }
  ];

  const pathD = `M ${coords[0].x} ${coords[0].y} 
    C ${coords[1].x} ${coords[1].y - 100}, ${coords[2].x - 100} ${coords[2].y}, ${coords[2].x} ${coords[2].y}
    S ${coords[4].x - 100} ${coords[4].y}, ${coords[4].x} ${coords[4].y}
    S ${coords[6].x - 100} ${coords[6].y}, ${coords[6].x} ${coords[6].y}
    S ${coords[8].x - 100} ${coords[8].y}, ${coords[8].x} ${coords[8].y}
    S ${coords[10].x - 100} ${coords[10].y}, ${coords[10].x} ${coords[10].y}
    S ${coords[12].x - 100} ${coords[12].y}, ${coords[12].x} ${coords[12].y}
    S ${coords[13].x - 50} ${coords[13].y}, ${coords[13].x} ${coords[13].y}`;

  return (
    <div className="p-4 md:p-8 max-w-full mx-auto min-h-screen flex flex-col relative overflow-hidden bg-transparent">
      
      {/* Progress Bar Top */}
      <div className="w-full max-w-4xl mx-auto bg-[var(--bg-card)] p-6 rounded-2xl border border-[var(--border-subtle)] shadow-xl mb-12 z-10 relative flex-shrink-0 backdrop-blur-md">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-secondary)] italic">DevSecOps Roadmap Velocity</span>
          <span className="text-xs font-black text-[var(--text-primary)] uppercase italic">{completedCount} / 14 Mission Milestones</span>
        </div>
        <div className="w-full h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden border border-[var(--border-subtle)] relative">
          <div 
            className="absolute top-0 left-0 h-full transition-all duration-1000 ease-out"
            style={{ 
              width: `${(completedCount / 14) * 100}%`,
              background: 'linear-gradient(90deg, #3b82f6, #fbbf24)',
              boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)'
            }}
          />
        </div>
      </div>

      {/* Main Curved Roadmap */}
      <div className="w-full relative overflow-x-auto custom-scrollbar pt-20 pb-10 flex-shrink-0" style={{ height: '600px' }}>
        <div className="min-w-[3000px] h-full relative px-20">
          
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
            <defs>
              <linearGradient id="roadGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="50%" stopColor="#ec4899" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
            </defs>

            {/* Background Path */}
            <path 
              d={pathD} 
              fill="none" 
              stroke="rgba(255,255,255,0.05)" 
              strokeWidth="12" 
              strokeLinecap="round"
            />

            {/* Active Glow Path */}
            <path 
              d={pathD} 
              fill="none" 
              stroke={theme === 'matrix' ? '#00ff41' : 'url(#roadGradient)'} 
              strokeWidth="6" 
              strokeLinecap="round"
              strokeDasharray="12,12"
              className="animate-dash"
            />
          </svg>

          {nodes.map((node, i) => {
            const pos = coords[i];
            const isTop = i % 2 === 0;
            const isComplete = node.status === 'COMPLETE';
            const isProgress = node.status === 'IN PROGRESS';
            
            return (
              <div 
                key={node.id}
                className="absolute flex flex-col items-center group cursor-pointer"
                style={{ 
                  left: pos.x, 
                  top: pos.y, 
                  transform: 'translate(-50%, -50%)',
                  zIndex: 20
                }}
                onClick={() => navigate(node.path)}
              >
                {/* Node Circle */}
                <div 
                  className={`w-14 h-14 rounded-full flex items-center justify-center border-4 transition-all duration-500 bg-[var(--bg-card)]
                    ${isProgress ? 'animate-pulse' : ''}
                  `}
                  style={{ 
                    borderColor: isComplete || isProgress ? node.color : 'rgba(255,255,255,0.1)',
                    boxShadow: isComplete || isProgress ? `0 0 30px ${node.color}66` : 'none',
                    filter: isComplete || isProgress ? 'none' : 'grayscale(1)'
                  }}
                >
                  <node.icon 
                    size={16} 
                    className={isComplete || isProgress ? 'text-white' : 'text-gray-500'} 
                  />
                </div>

                {/* Status Badge */}
                <div 
                  className={`absolute -top-8 px-3 py-1 rounded-full text-[7px] font-black uppercase tracking-widest border backdrop-blur-md transition-all
                    ${isComplete ? 'bg-green-500/20 border-green-500/40 text-green-400' : 
                      isProgress ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' : 
                      'bg-gray-500/10 border-white/5 text-gray-500'}
                  `}
                >
                  {node.status}
                </div>

                {/* Label */}
                <div 
                  className={`absolute w-40 text-center transition-all group-hover:scale-110
                    ${isTop ? 'top-24' : '-bottom-16'}
                  `}
                >
                  <span className="text-xs font-black text-[var(--text-primary)] uppercase italic tracking-tighter block">
                    {node.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats Summary at Bottom */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 z-10 relative mt-auto border-t border-[var(--border-subtle)] pt-12 flex-shrink-0">
        {[
          { label: 'Repos', value: stats.repos, icon: GitBranch, color: 'text-blue-500' },
          { label: 'Scans', value: stats.scans, icon: Radar, color: 'text-orange-500' },
          { label: 'Open', value: stats.openVulns, icon: Bug, color: 'text-red-500' },
          { label: 'Resolved', value: stats.resolvedVulns, icon: Trophy, color: 'text-green-500' },
          { label: 'Tasks', value: stats.tasks, icon: CheckSquare, color: 'text-pink-500' },
          { label: 'Reports', value: stats.reports, icon: FileText, color: 'text-teal-500' },
          { label: 'Live', value: stats.recentlyMonitored ? 'YES' : 'NO', icon: Activity, color: stats.recentlyMonitored ? 'text-cyan-500' : 'text-gray-500' },
        ].map((stat, i) => (
          <div key={i} className="premium-card p-4 flex flex-col items-center text-center gap-2 group hover:border-white/20 transition-all bg-[var(--bg-card)]/50">
            <div className={`p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] ${stat.color} group-hover:scale-110 transition-transform`}>
              <stat.icon size={18} />
            </div>
            <div>
              <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{stat.label}</p>
              <p className="text-lg font-black text-[var(--text-primary)] leading-none mt-1">
                {loading ? '...' : stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>
      
      {/* Pipeline Intelligence Section */}
      <div className="mt-8 p-8 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl z-10 relative backdrop-blur-xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex-1 w-full">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-[var(--accent-primary)]/10 rounded-xl flex items-center justify-center border border-[var(--accent-primary)]/20">
                <Activity className="text-[var(--accent-primary)] w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tighter italic leading-none">Pipeline Intelligence</h2>
                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Real-time telemetry from all connected nodes</p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-12">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Repos Connected</span>
                <span className="text-2xl font-black text-[var(--text-primary)] italic tracking-tighter">{stats.repos}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Scans Executed</span>
                <span className="text-2xl font-black text-[var(--text-primary)] italic tracking-tighter">{stats.scans}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Tasks Active</span>
                <span className="text-2xl font-black text-[var(--text-primary)] italic tracking-tighter">{stats.tasks}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Vulns Resolved</span>
                <span className="text-2xl font-black text-[var(--status-success)] italic tracking-tighter">{stats.resolvedVulns}</span>
              </div>
              <div className="flex flex-col lg:col-span-2">
                <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Last Scan</span>
                <span className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tighter truncate">
                  {stats.lastScanDate !== 'N/A' ? stats.lastScanDate : 'No scans yet'}
                </span>
              </div>
            </div>
          </div>

          <div className="w-full md:w-64 flex flex-col items-center justify-center p-6 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
              <Scale className="w-16 h-16" />
            </div>
            <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-4">Pipeline Health</span>
            <div className="relative w-24 h-24 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="transparent"
                  className="text-[var(--border-subtle)]"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={`${(completedCount / 14) * 251.2} 251.2`}
                  strokeLinecap="round"
                  className="text-[var(--accent-primary)] transition-all duration-1000 ease-out"
                  style={{ filter: 'drop-shadow(0 0 4px var(--accent-primary))' }}
                />
              </svg>
              <span className="absolute text-xl font-black text-[var(--text-primary)] italic tracking-tighter">
                {Math.round((completedCount / 14) * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes dash {
            to {
              stroke-dashoffset: -24;
            }
          }
          .animate-dash {
            animation: dash 1s linear infinite;
          }
          .custom-scrollbar::-webkit-scrollbar {
            height: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: var(--border-subtle);
            border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: var(--text-secondary);
          }
        `}
      </style>
    </div>
  );
}
