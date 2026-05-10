import React, { useEffect, useState, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Shield, Activity, AlertCircle, Eye, Calendar, Clock, GitBranch,
  CheckCircle, FileText, XCircle, Layout, TrendingUp, ShieldX,
  ShieldCheck, ShieldAlert, Zap, Bug, Wind
} from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell
} from 'recharts';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import logoImg from '../assets/pre-final_logo-removebg-preview.png';

const SecurityRadarChart = memo(({ data }: { data: any[] }) => (
  <div style={{ background: 'var(--chart-bg)', width: '100%', height: '100%', borderRadius: 'inherit' }}>
    <ResponsiveContainer width="100%" height="100%" minHeight={100}>
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
        <PolarGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fill: 'var(--chart-label)', fontSize: 11, fontWeight: 'bold' }}
        />
        <PolarRadiusAxis
          angle={30}
          domain={[0, 100]}
          tick={false}
        />
        <Radar
          name="Observed"
          dataKey="Observed"
          stroke="var(--chart-fill)"
          fill="var(--chart-fill)"
          fillOpacity={parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chart-fill-opacity')) || 0.4}
          isAnimationActive={false}
        />
        <RechartsTooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            fontSize: '10px',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            color: 'var(--text-primary)'
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  </div>
));

export default function Dashboard({ isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { theme, getLogoFilter } = useTheme();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [individualErrors, setIndividualErrors] = useState<Record<string, boolean>>({});

  const [ciGateStats, setCiGateStats] = useState({ passed: 0, blocked: 0, rate: 0 });
  const [totalAssets, setTotalAssets] = useState({ count: 0, isNew: false });
  const [activeScansCount, setActiveScansCount] = useState(0);
  const [policyPassRate, setPolicyPassRate] = useState(100);
  
  const [vulnStats, setVulnStats] = useState({
    critical: 0, high: 0, medium: 0, low: 0, bugs: 0, codeSmells: 0, total: 0, score: 100
  });

  const [scanActivity, setScanActivity] = useState<any[]>([]);
  const [topRepos, setTopRepos] = useState<any[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);

  const fetchDashboardData = useCallback(async (isAuto = false) => {
    // Only show global skeleton on initial load, not on auto-refresh or manual refresh
    if (!isAuto && loading && !isRefreshing) setLoading(true);
    
    // 5-second safety fallback to prevent stuck skeletons
    const timeout = setTimeout(() => {
      setLoading(false);
      setIsRefreshing(false);
    }, 5000);

    try {
      // 1. Fetch Latest Scans
      const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.orderDesc('$createdAt'),
        Query.limit(100)
      ]);
      const scans = scansRes.documents;
      
      let passed = 0; let blocked = 0; let active = 0;
      let aggCrit = 0, aggHigh = 0, aggMed = 0, aggLow = 0, aggBugs = 0, aggSmells = 0, aggTotal = 0, aggScoreTotal = 0;
      let countWithScore = 0;
      const latestScanPerRepo: Record<string, any> = {};
      const daysActivity = { 'Su': 0, 'Mo': 0, 'Tu': 0, 'We': 0, 'Th': 0, 'Fr': 0, 'Sa': 0 };
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      scans.forEach(s => {
        if (s.repositoryId && !latestScanPerRepo[s.repositoryId]) {
          latestScanPerRepo[s.repositoryId] = s;
          aggCrit += (s.critical || 0);
          aggHigh += (s.high || 0);
          aggMed += (s.medium || 0);
          aggLow += (s.low || 0);
          aggBugs += (s.bugs || 0);
          aggSmells += (s.code_smells || s.codeSmells || 0);
          aggTotal += (s.vulnerabilities || (s.critical + s.high + s.medium + s.low) || 0);
          if (s.security_score !== undefined || s.security_rating !== undefined) {
            aggScoreTotal += (s.security_score || s.security_rating || 0);
            countWithScore++;
          }
        }
        if (s.gateStatus === 'passed') passed++;
        if (s.gateStatus === 'failed' || s.gateStatus === 'blocked') blocked++;
        if (s.status === 'running' || s.status === 'pending') active++;
        const d = new Date(s.$createdAt);
        if (d >= weekAgo) {
          const dayStr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d.getDay()];
          daysActivity[dayStr as keyof typeof daysActivity]++;
        }
      });

      setCiGateStats({ passed, blocked, rate: (passed + blocked) > 0 ? Math.round((passed / (passed + blocked)) * 100) : 0 });
      setActiveScansCount(active);
      setScanActivity(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => ({ name: d, scans: daysActivity[d as keyof typeof daysActivity] || 0 })));

      // 2. Fetch Repos
      const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.orderDesc('$createdAt'), Query.limit(50)]);
      setTotalAssets({ count: reposRes.total, isNew: reposRes.documents.some(r => (now.getTime() - new Date(r.$createdAt).getTime()) < 24 * 60 * 60 * 1000) });
      setTopRepos([...reposRes.documents].sort((a, b) => (b.vulnerabilityCount || 0) - (a.vulnerabilityCount || 0)).slice(0, 5));

      // 3. Finalize Stats
      const score = countWithScore > 0 ? Math.round(aggScoreTotal / countWithScore) : Math.max(0, 100 - (aggCrit * 10) - (aggHigh * 5));
      setVulnStats({ critical: aggCrit, high: aggHigh, medium: aggMed, low: aggLow, bugs: aggBugs, codeSmells: aggSmells, total: aggTotal, score });
      setPolicyPassRate(score > 80 ? 100 : score > 50 ? 80 : 40);

      // 4. Alerts
      const notifsRes = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [Query.orderDesc('$createdAt'), Query.limit(10)]).catch(() => ({ documents: [] }));
      setRecentAlerts(notifsRes.documents);

      if (isAuto) toast.success('Data updated', { id: 'auto-refresh', style: { background: '#1a1a1a', color: '#7bc67e', fontSize: '10px' } });
      setError(null);
    } catch (err: any) {
      console.error('[Dashboard] Fetch error:', err);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []); // Empty deps to prevent re-fetch on theme change

  useEffect(() => {
    fetchDashboardData();
    
    // Real-time subscription
    const unsubscribe = client.subscribe(
      [
        `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`,
        `databases.${DB_ID}.collections.${COLLECTIONS.NOTIFICATIONS}.documents`
      ],
      (response) => {
        // Trigger a background refresh when a new document is created or updated
        if (response.events.some(e => e.includes('.create') || e.includes('.update'))) {
          fetchDashboardData(true);
        }
      }
    );

    const interval = setInterval(() => {
      fetchDashboardData(true);
    }, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [fetchDashboardData]);

  const threatData = [
    { axis: 'Critical', Observed: vulnStats.critical },
    { axis: 'High', Observed: vulnStats.high },
    { axis: 'Medium', Observed: vulnStats.medium },
    { axis: 'Low', Observed: vulnStats.low },
    { axis: 'Bugs', Observed: vulnStats.bugs },
    { axis: 'Vulnerabilities', Observed: vulnStats.total },
    { axis: 'Code Smells', Observed: vulnStats.codeSmells },
    { axis: 'Security', Observed: vulnStats.score },
  ];

  const metrics = [
    { label: 'Critical Vulnerabilities', value: vulnStats.critical, icon: ShieldX, color: 'var(--status-error)' },
    { label: 'High Vulnerabilities', value: vulnStats.high, icon: ShieldAlert, color: 'var(--severity-high)' },
    { label: 'Medium Vulnerabilities', value: vulnStats.medium, icon: AlertCircle, color: 'var(--status-warning)' },
    { label: 'Low Risk', value: vulnStats.low, icon: ShieldCheck, color: 'var(--status-success)' },
    { label: 'Bugs', value: vulnStats.bugs, icon: Bug, color: 'var(--severity-info)' },
    { label: 'Vulnerabilities', value: vulnStats.total, icon: Activity, color: 'var(--accent-primary)' },
    { label: 'Code Smells', value: vulnStats.codeSmells, icon: Wind, color: 'var(--status-warning)' },
    { label: 'Security Posture', value: `${vulnStats.score}%`, icon: Zap, color: 'var(--status-success)' },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Keep data visible, don't reset to zero or skeletons
    await fetchDashboardData();
  };

  if (error) {
    return (
      <div className="flex-1 w-full pl-0 pr-0 pb-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <XCircle size={48} className="mx-auto text-[var(--status-error)] mb-4" />
          <h2 className="text-lg font-bold text-[var(--text-primary)] mb-2">Failed to load dashboard data</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{error}</p>
          <button onClick={handleRefresh} className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded-lg text-sm font-bold shadow-sm hover:brightness-110">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const SkeletonCard = ({ h }: { h: string }) => (
    <div className={`bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] animate-pulse ${h}`}>
       <div className="w-1/2 h-4 bg-gray-200 rounded mb-4"></div>
       <div className="w-1/3 h-8 bg-gray-200 rounded"></div>
    </div>
  );

  return (
    <div className="flex-1 w-full pl-0 pr-0 pb-8" style={{ background: 'transparent' }}>
      
      {/* Top Stat Cards (Row 1) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[
          { id: 'ci', label: 'CI Gate Integrity', value: `${ciGateStats.rate}%`, trend: 'Success Rate', color: 'var(--status-success)', counts: `Passed: ${ciGateStats.passed} | Blocked: ${ciGateStats.blocked}` },
          { id: 'assets', label: 'Total Assets', value: totalAssets.count.toString(), trend: totalAssets.isNew ? '+New' : '', color: 'var(--accent-primary)' },
          { id: 'scans', label: 'Active Scans', value: activeScansCount.toString(), trend: activeScansCount > 0 ? 'Running' : 'Idle', color: 'var(--status-warning)' },
          { id: 'policy', label: 'Policy Pass', value: `${policyPassRate}%`, trend: 'Compliance', color: 'var(--status-success)' }
        ].map((stat, i) => (
          loading ? <SkeletonCard key={i} h="h-32" /> :
          <div key={i} className="bg-[var(--bg-card)] rounded-[16px] p-6 relative overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between h-32">
            <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: stat.color }}></div>
            
            <div className="flex justify-between items-start">
              <h3 className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">{stat.label}</h3>
              {individualErrors[stat.id] ? (
                <div className="px-2 py-0.5 rounded-full bg-red-50 border border-red-100 text-[8px] font-black text-red-600 uppercase">Error</div>
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center opacity-20" style={{ backgroundColor: stat.color, color: stat.color }}>
                  <Activity size={16} />
                </div>
              )}
            </div>
            
            <div className="flex justify-between items-end mt-auto">
              <div>
                 <span className="text-[32px] font-black text-[var(--text-primary)] leading-none">{stat.value}</span>
                 {stat.counts && <div className="text-[9px] font-bold text-[var(--text-secondary)] mt-1">{stat.counts}</div>}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: stat.color }}>{stat.trend}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Middle Section: Pulse & Vulnerability Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-8">
        
        {/* Security Pulse */}
        <div className="xl:col-span-7 flex flex-col min-h-[400px]">
          {loading ? <SkeletonCard h="h-full w-full" /> : 
          <div className="bg-[var(--bg-card)] rounded-[16px] p-8 shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col flex-1">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Security Pulse</h2>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">Real-time Anomaly Vectors</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-medium text-[var(--text-secondary)] italic">Updated at {new Date().toLocaleTimeString()}</span>
                <button 
                  onClick={handleRefresh}
                  disabled={loading || isRefreshing}
                  className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 ${
                    theme === 'dark' 
                      ? 'bg-[#1e1e1e] text-[#7bc67e] border border-[#2a2a2a] hover:bg-[#252525]' 
                      : 'text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/5'
                  }`}
                >
                  <Activity size={12} className={isRefreshing ? "animate-spin" : ""} />
                  ⟳ REFRESH
                </button>
              </div>
            </div>
            <div className="flex-1 w-full relative">
               <SecurityRadarChart data={threatData} />
            </div>
          </div>
          }
        </div>

        {/* Right Vulnerability Grid */}
        <div className="xl:col-span-5 grid grid-cols-2 gap-4">
          {metrics.map((m, i) => (
            loading ? <SkeletonCard key={i} h="h-32" /> :
            <div key={i} className="bg-[var(--bg-card)] rounded-[16px] p-5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between">
              <div className="flex justify-between items-start mb-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                  <m.icon size={14} />
                </div>
                {individualErrors[m.label] ? (
                  <div className="px-2 py-0.5 rounded-full bg-red-50 border border-red-100 text-[8px] font-black text-red-600 uppercase">Failed</div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-50 border border-green-100">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-[9px] font-black text-green-700 uppercase tracking-widest">LIVE</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">{m.label}</p>
              <div className="flex justify-between items-end mt-auto">
                <span className="text-[28px] font-black text-[var(--text-primary)] leading-none">{m.value}</span>
                <TrendingUp size={16} className="text-gray-300" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Scan Activity */}
        <div className="flex flex-col">
          {loading ? <SkeletonCard h="h-64" /> :
          <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full">
            <h3 className="text-[13px] font-black text-[var(--text-primary)] uppercase tracking-wider mb-6">Scan Activity</h3>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scanActivity} barSize={16}>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} dy={10} />
                  <RechartsTooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontSize: '10px', fontWeight: 'bold' }} />
                  <Bar dataKey="scans" radius={[4, 4, 0, 0]}>
                    {scanActivity.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === (scanActivity.length - 1) ? 'var(--accent-primary)' : '#e5e7eb'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          }
        </div>

        {/* Top Vulnerable Repositories */}
        <div className="flex flex-col">
          {loading ? <SkeletonCard h="h-64" /> :
          <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full">
            <h3 className="text-[13px] font-black text-[var(--text-primary)] uppercase tracking-wider mb-6">Top Vulnerable Repos</h3>
            <div className="flex flex-col gap-4">
              {topRepos.slice(0, 5).map((repo, i) => (
                <div key={i} className="flex items-center justify-between group cursor-pointer" onClick={() => navigate(`/repos/${repo.$id}`)}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                      <GitBranch size={14} />
                    </div>
                    <div>
                      <h4 className="text-[12px] font-bold text-[var(--text-primary)] truncate max-w-[120px] group-hover:text-[var(--accent-primary)] transition-colors">{repo.url?.split('/').pop()?.replace('.git', '') || repo.name || 'System Repo'}</h4>
                      <p className="text-[10px] text-[var(--text-secondary)]">{repo.vulnerabilityCount || 0} Vulnerabilities</p>
                    </div>
                  </div>
                  <div className="px-2.5 py-1 rounded-md bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                    {repo.vulnerabilityCount > 10 ? 'Critical' : 'High'} Risk
                  </div>
                </div>
              ))}
              {topRepos.length === 0 && <div className="text-[11px] text-[var(--text-secondary)] text-center py-4">No repositories found.</div>}
            </div>
          </div>
          }
        </div>

        {/* Recent Alerts */}
        <div className="flex flex-col">
          {loading ? <SkeletonCard h="h-64" /> :
          <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full">
            <h3 className="text-[13px] font-black text-[var(--text-primary)] uppercase tracking-wider mb-6">Recent Alerts</h3>
            <div className="flex flex-col gap-5">
              {recentAlerts.slice(0, 10).map((alert, i) => (
                <div key={i} className="flex gap-4">
                  <div className="relative mt-1">
                    <div className={`w-2.5 h-2.5 rounded-full ${alert.severity === 'high' || alert.severity === 'critical' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                    {i !== (recentAlerts.length - 1) && <div className="absolute top-3 left-1/2 -translate-x-1/2 w-px h-8 bg-gray-200"></div>}
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold text-[var(--text-primary)] mb-0.5 line-clamp-1">{alert.title || alert.message || 'System Alert'}</h4>
                    <p className="text-[10px] font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
                      <Clock size={10} /> {new Date(alert.$createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {recentAlerts.length === 0 && <div className="text-[11px] text-[var(--text-secondary)] text-center py-4">No recent alerts.</div>}
            </div>
          </div>
          }
        </div>

      </div>

    </div>
  );
}
