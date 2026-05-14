import React, { useEffect, useState, memo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Shield, Activity, AlertCircle, Eye, Calendar, Clock, GitBranch,
  CheckCircle, FileText, XCircle, Layout, TrendingUp, ShieldX,
  ShieldCheck, ShieldAlert, Zap, Bug
} from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell
} from 'recharts';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import logoImg from '../assets/pre-final_logo-removebg-preview.png';
import PostureRoadmap from './PostureRoadmap';

const SecurityRadarChart = memo(({ data }: { data: any[] }) => {
  // Normalize data for the radar chart to ensure it doesn't appear flat
  // Score is already 0-100, but counts need to be scaled
  const maxCount = Math.max(...data.filter(d => d.axis !== 'Security').map(d => d.Observed), 10);
  const normalizedData = data.map(d => ({
    ...d,
    // Scale counts to 0-100 range for visual consistency, while keeping Security as is
    fullValue: d.axis === 'Security' ? d.Observed : (d.Observed / maxCount) * 100,
    actualValue: d.Observed
  }));

  return (
    <div style={{ background: 'var(--chart-bg)', width: '100%', height: '100%', borderRadius: 'inherit' }}>
      <ResponsiveContainer width="100%" height="100%" minHeight={300}>
        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={normalizedData}>
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
            dataKey="fullValue"
            stroke="var(--chart-fill)"
            fill="var(--chart-fill)"
            fillOpacity={0.4}
            isAnimationActive={true}
          />
          <RechartsTooltip
            formatter={(value: any, name: any, props: any) => [props.payload.actualValue, name]}
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
  );
});

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
    critical: 0, high: 0, medium: 0, low: 0, bugs: 0, 
    codeSmells: 0, total: 0, score: 100, linesScanned: 0
  });

  const [scanActivity, setScanActivity] = useState<any[]>([]);
  const [topRepos, setTopRepos] = useState<any[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [latestScanId, setLatestScanId] = useState<string | null>(null);
  const [gateSummary, setGateSummary] = useState<any[]>([]);
  const [showGateSummary, setShowGateSummary] = useState(false);
  const isFetchingRef = useRef(false);

  const fetchDashboardData = useCallback(async (isAuto = false) => {
    // Note: handleRefresh may set isFetchingRef.current to true before calling this
    if (isFetchingRef.current && !isRefreshing) return;
    isFetchingRef.current = true;

    if (!isAuto && loading && !isRefreshing) setLoading(true);
    
    const timeout = setTimeout(() => {
      setLoading(false);
      setIsRefreshing(false);
      isFetchingRef.current = false;
    }, 8000);

    try {
      const token = await getJWT();
      
      // Fetch Gate Summary
      const gateRes = await fetch('/api/gates/summary', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const gateData = await gateRes.json();
      setGateSummary(gateData.failedRepos || []);

      // 1. Fetch User's Repositories
      const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
        Query.orderDesc('$createdAt'),
        Query.limit(100)
      ]);
      const repoIds = reposRes.documents.map(r => r.$id);
      const repoUrls = reposRes.documents.map(r => r.url).filter(Boolean);

      if (repoIds.length === 0) {
        setLoading(false);
        return;
      }

      // 2. Fetch Latest Completed Scan (The Source of Truth for Stats)
      const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.or([
          Query.equal('repo_id', repoIds),
          Query.equal('repoUrl', repoUrls)
        ]),
        Query.equal('status', 'completed'),
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]);
      const latestCompletedScan = scansRes.documents[0] || null;

      // --- DIAGNOSTIC LOGGING ---
      console.log('Latest scan ID:', latestCompletedScan?.$id);
      console.log('Latest scan data:', {
        status: latestCompletedScan?.status,
        critical: latestCompletedScan?.criticalCount || latestCompletedScan?.critical,
        high: latestCompletedScan?.highCount || latestCompletedScan?.high,
        medium: latestCompletedScan?.mediumCount || latestCompletedScan?.medium,
        low: latestCompletedScan?.lowCount || latestCompletedScan?.low,
        total: latestCompletedScan?.vulnerabilities,
        createdAt: latestCompletedScan?.$createdAt
      });
      // -------------------------

      // 3. Fetch Recent Scans for Charts/Activity (Separate query to avoid interference)
      const activityRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.or([
          Query.equal('repo_id', repoIds),
          Query.equal('repoUrl', repoUrls)
        ]),
        Query.orderDesc('$createdAt'),
        Query.limit(50)
      ]);
      const scans = activityRes.documents;
      
      let passed = 0; let blocked = 0; let active = 0;
      const daysActivity = { 'Su': 0, 'Mo': 0, 'Tu': 0, 'We': 0, 'Th': 0, 'Fr': 0, 'Sa': 0 };
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Process scans for activity and gate stats (Global)
      scans.forEach(s => {
        let gate = s.gateStatus || s.gate_status;
        if (s.details && typeof s.details === 'string') {
          try {
            const d = JSON.parse(s.details);
            if (d.gate_status) gate = d.gate_status;
          } catch (e) {}
        }

        if (gate === 'passed') passed++;
        if (gate === 'failed' || gate === 'blocked') blocked++;
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

      // 4. Extract Stats from LATEST COMPLETED scan only
      if (latestCompletedScan) {
        setLatestScanId(latestCompletedScan.$id);
        
        // Appwrite fields use camelCase: criticalCount, highCount, etc.
        let crit = Number(latestCompletedScan.criticalCount ?? 0);
        let high = Number(latestCompletedScan.highCount ?? 0);
        let med = Number(latestCompletedScan.mediumCount ?? 0);
        let low = Number(latestCompletedScan.lowCount ?? 0);
        let bugs = Number(latestCompletedScan.bugs ?? 0);
        let total = Number(latestCompletedScan.vulnerabilities ?? 0);
        let score = latestCompletedScan.security_score ?? latestCompletedScan.security_rating;
        let lines = 0;

        // Diagnostic log fix: Use ?? to see 0 values
        console.log('Processed Scan Metrics:', { crit, high, med, low, score, total });

        if (latestCompletedScan.details && typeof latestCompletedScan.details === 'string') {
          try {
            const d = JSON.parse(latestCompletedScan.details);
            if (d.critical_count !== undefined) crit = Math.max(crit, Number(d.critical_count));
            if (d.high_count !== undefined) high = Math.max(high, Number(d.high_count));
            if (d.medium_count !== undefined) med = Math.max(med, Number(d.medium_count));
            if (d.low_count !== undefined) low = Math.max(low, Number(d.low_count));
            if (d.total_vulnerabilities !== undefined) total = Math.max(total, Number(d.total_vulnerabilities));
            if (d.security_score !== undefined) score = d.security_score;
            if (d.bugs !== undefined) bugs = Math.max(bugs, Number(d.bugs));
            if (d.total_lines !== undefined) lines = Number(d.total_lines);
          } catch (e) {}
        }

        if (total === 0) total = crit + high + med + low;
        const finalScore = score !== undefined && score !== null ? Math.round(Number(score)) : Math.max(0, Math.round(100 - (crit * 10) - (high * 4) - (med * 1) - (low * 0.25)));

        setVulnStats({
          critical: crit, high, medium: med, low, bugs, total, score: finalScore, linesScanned: lines, codeSmells: 0
        });
        setPolicyPassRate(finalScore > 85 ? 100 : finalScore > 65 ? 80 : finalScore > 40 ? 60 : 30);
      } else {
        setVulnStats({ critical: 0, high: 0, medium: 0, low: 0, bugs: 0, total: 0, score: 0, linesScanned: 0, codeSmells: 0 });
        setPolicyPassRate(0);
      }

      // 5. Enriched Top Repositories
      const topReposList = reposRes.documents.map(repo => {
        const latestRepoScan = scans.find(s => s.repo_id === repo.$id || s.repoUrl === repo.url);
        let count = 0;
        if (latestRepoScan) {
          count = Number(latestRepoScan.vulnerabilities ?? 0);
          if (latestRepoScan.details && typeof latestRepoScan.details === 'string') {
            try {
              const d = JSON.parse(latestRepoScan.details);
              count = d.total_vulnerabilities ?? (Number(d.critical_count || 0) + Number(d.high_count || 0));
            } catch (e) {}
          }
        }
        return { ...repo, vulnerabilityCount: count };
      }).sort((a, b) => (b.vulnerabilityCount || 0) - (a.vulnerabilityCount || 0)).slice(0, 5);

      setTotalAssets({ count: reposRes.total, isNew: reposRes.documents.some(r => (now.getTime() - new Date(r.$createdAt).getTime()) < 24 * 60 * 60 * 1000) });
      setTopRepos(topReposList);

      const notifsRes = await databases.listDocuments(DB_ID, COLLECTIONS.NOTIFICATIONS, [Query.orderDesc('$createdAt'), Query.limit(10)]).catch(() => ({ documents: [] }));
      setRecentAlerts(notifsRes.documents);

      if (isAuto) toast.success('Data updated', { id: 'auto-refresh', style: { background: '#1a1a1a', color: '#7bc67e', fontSize: '10px' } });
      setError(null);
    } catch (err: any) {
      console.error('[Dashboard] Fetch error:', err);
    } finally {
      clearTimeout(timeout);
      isFetchingRef.current = false;
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [loading, isRefreshing]); // Empty deps to prevent re-fetch on theme change

  useEffect(() => {
    fetchDashboardData();
    
    // Manual refresh listener for external triggers (e.g. Scan Modal)
    const handleManualRefresh = () => fetchDashboardData(true);
    window.addEventListener('refresh-dashboard', handleManualRefresh);

    // Simplified Realtime Subscription (Relying on SDK internal reconnect + polling fallback)
    const unsubscribe = client.subscribe(
      [
        `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`,
        `databases.${DB_ID}.collections.${COLLECTIONS.NOTIFICATIONS}.documents`
      ],
      (response) => {
        if (response.events.some(e => e.includes('.create') || e.includes('.update'))) {
          // Only refresh if it's a notification OR a completed scan
          const payload = response.payload as any;
          if (payload?.status === 'completed' || response.events.some(e => e.includes('notifications'))) {
            fetchDashboardData(true);
          }
        }
      }
    );

    const interval = setInterval(() => {
      fetchDashboardData(true);
    }, 30000); // 30s interval as fallback

    return () => {
      if (unsubscribe) unsubscribe();
      window.removeEventListener('refresh-dashboard', handleManualRefresh);
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
    { axis: 'Lines', Observed: Math.min(Math.round(vulnStats.linesScanned / 100), 100) },
    { axis: 'Security', Observed: vulnStats.score },
  ];

  const metrics = [
    { id: 'critical', label: 'Critical Vulnerabilities', value: vulnStats.critical, icon: ShieldX, color: 'var(--status-error)', path: `/scans/${latestScanId}/sast?filter=critical` },
    { id: 'high', label: 'High Vulnerabilities', value: vulnStats.high, icon: ShieldAlert, color: 'var(--severity-high)', path: `/scans/${latestScanId}/sast?filter=high` },
    { id: 'medium', label: 'Medium Vulnerabilities', value: vulnStats.medium, icon: AlertCircle, color: 'var(--status-warning)', path: `/scans/${latestScanId}/sast?filter=medium` },
    { id: 'low', label: 'Low Risk', value: vulnStats.low, icon: ShieldCheck, color: 'var(--status-success)', path: `/scans/${latestScanId}/sast?filter=low` },
    { id: 'bugs', label: vulnStats.bugs > 0 ? 'Bugs (Bandit)' : 'Bugs (Python only)', value: vulnStats.bugs, icon: Bug, color: 'var(--severity-info)', path: `/scans/${latestScanId}/antipatterns` },
    { id: 'vulns', label: 'Vulnerabilities', value: vulnStats.total, icon: Activity, color: 'var(--accent-primary)', path: `/scans/${latestScanId}/sast` },
    { id: 'lines', label: 'Lines Scanned', value: vulnStats.linesScanned?.toLocaleString() || '0', icon: FileText, color: 'var(--accent-primary)' },
    { id: 'posture', label: 'Security Posture', value: `${vulnStats.score}%`, icon: Zap, color: 'var(--status-success)', path: `/scans/${latestScanId}/sast` },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setVulnStats({ critical: 0, high: 0, medium: 0, low: 0, bugs: 0, total: 0, score: 0, linesScanned: 0, codeSmells: 0 });
    setPolicyPassRate(0);
    
    // Block auto-triggered fetches during manual refresh
    isFetchingRef.current = true;
    
    await fetchDashboardData();
    // isFetchingRef.current is reset to false inside fetchDashboardData's finally block
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
          <div key={i} 
               onClick={() => stat.id === 'ci' && setShowGateSummary(true)}
               className={`bg-[var(--bg-card)] rounded-[16px] p-6 relative overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between h-32 transition-all ${stat.id === 'ci' ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: stat.color }}></div>
            
            <div className="flex justify-between items-start">
              <h3 className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider group-hover:text-[var(--accent-primary)] transition-colors">{stat.label}</h3>
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

      {/* Gate Summary Modal */}
      {showGateSummary && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-card)] w-full max-w-lg rounded-2xl p-8 border border-[var(--border-subtle)] shadow-2xl">
            <h2 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-wider mb-6 flex items-center gap-2">
              <ShieldAlert className="text-[var(--status-error)]" size={20} /> Policy Blocking Summary
            </h2>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              {gateSummary.length > 0 ? gateSummary.map((repo, i) => (
                <div key={i} className="p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[12px] font-bold text-[var(--text-primary)]">{repo.name}</span>
                    <span className="text-[10px] font-black text-[var(--status-error)] uppercase">Blocked</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{repo.reason}</p>
                </div>
              )) : (
                <div className="text-center py-12">
                  <ShieldCheck className="mx-auto text-[var(--status-success)] mb-3" size={32} />
                  <p className="text-[13px] font-bold text-[var(--text-primary)]">All monitored assets are compliant.</p>
                </div>
              )}
            </div>
            <button 
              onClick={() => setShowGateSummary(false)}
              className="w-full mt-8 py-3 bg-[var(--accent-primary)] text-white font-black uppercase tracking-widest rounded-xl hover:brightness-110 transition-all"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* Middle Section: Pulse & Vulnerability Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-8">
        
        {/* Security Pulse */}
        <div className="xl:col-span-7 flex flex-col min-h-[400px]">
          <PostureRoadmap />
        </div>

        {/* Right Vulnerability Grid */}
        <div className="xl:col-span-5 grid grid-cols-2 gap-4">
          {metrics.map((m, i) => (
            loading ? <SkeletonCard key={i} h="h-32" /> :
            <div key={i} 
                 onClick={() => {
                   if (m.path?.includes('null')) return;
                   m.path && navigate(m.path);
                 }}
                 className={`bg-[var(--bg-card)] rounded-[16px] p-5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between ${!m.path ? 'cursor-default' : m.path.includes('null') ? 'cursor-wait opacity-80' : 'cursor-pointer group hover:scale-[1.02]'} transition-all`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                  <m.icon size={14} />
                </div>
                {individualErrors[m.id] ? (
                  <div className="px-2 py-0.5 rounded-full bg-red-50 border border-red-100 text-[8px] font-black text-red-600 uppercase">Failed</div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-50 border border-green-100">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-[9px] font-black text-green-700 uppercase tracking-widest">LIVE</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1 group-hover:text-[var(--accent-primary)] transition-colors">{m.label}</p>
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
              <ResponsiveContainer width="100%" height="100%" minHeight={180}>
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
