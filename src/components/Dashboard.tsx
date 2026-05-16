import React, { useEffect, useState, memo, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Shield, Activity, AlertCircle, Eye, Calendar, Clock,
  CheckCircle, FileText, XCircle, Layout, TrendingUp, ShieldX,
  ShieldCheck, ShieldAlert, Zap, Bug
} from 'lucide-react';
import { QualityGateCard, GradeBadge } from './QualityGate';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip as RechartsTooltip
} from 'recharts';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import logoImg from '../assets/pre-final_logo-removebg-preview.png';
import PostureRoadmap from './PostureRoadmap';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#ff5252', HIGH: '#ff8a00',
  MEDIUM: '#ffd740', LOW: '#69f0ae', INFO: '#40c4ff'
};

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
  const [activeScansCount, setActiveScansCount] = useState(0);
  const [policyPassRate, setPolicyPassRate] = useState(100);

  const [vulnStats, setVulnStats] = useState({
    critical: 0, high: 0, medium: 0, low: 0, bugs: 0,
    codeSmells: 0, total: 0, score: 100, linesScanned: 0
  });

  const [latestScanId, setLatestScanId] = useState<string | null>(null);
  const [latestScan, setLatestScan] = useState<any>(null);
  const [latestVulnerabilities, setLatestVulnerabilities] = useState<any[]>([]);
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
      const now = new Date();

      // Process scans for activity and gate stats (Global)
      scans.forEach(s => {
        let gate = s.gateStatus || s.gate_status;
        if (s.details && typeof s.details === 'string') {
          try {
            const d = JSON.parse(s.details);
            if (d.gate_status) gate = d.gate_status;
          } catch (e) { }
        }

        if (gate === 'passed') passed++;
        if (gate === 'failed' || gate === 'blocked') blocked++;
        if (s.status === 'running' || s.status === 'pending') active++;
      });

      setCiGateStats({ passed, blocked, rate: (passed + blocked) > 0 ? Math.round((passed / (passed + blocked)) * 100) : 0 });
      setActiveScansCount(active);

      // 4. Extract Stats from LATEST COMPLETED scan only
      if (latestCompletedScan) {
        setLatestScanId(latestCompletedScan.$id);
        setLatestScan(latestCompletedScan);

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
          } catch (e) { }
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


      // Fetch Latest Vulnerabilities
      const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.orderDesc('$createdAt'),
        Query.limit(5)
      ]).catch(() => ({ documents: [] }));
      setLatestVulnerabilities(vulnsRes.documents);

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
        `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`
      ],
      (response) => {
        if (response.events.some(e => e.includes('.create') || e.includes('.update'))) {
          // Only refresh if it's a completed scan
          const payload = response.payload as any;
          if (payload?.status === 'completed') {
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
    <div className="min-h-screen transition-colors duration-300" style={{ backgroundColor: theme === 'dark' ? '#0a0a0a' : 'var(--bg-primary)', padding: '12px' }}>
      <div className="w-full mx-auto">


        {/* Top Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 items-stretch">
          {[
            { id: 'ci', label: 'CI Gate Integrity', value: `${ciGateStats.rate}%`, trend: 'Success Rate', color: 'var(--status-success)', counts: `Passed: ${ciGateStats.passed} | Blocked: ${ciGateStats.blocked}` },
            { id: 'quality', label: 'QUALITY GATE', value: '0/100', trend: 'Not computed', color: 'var(--text-secondary)' },
            { id: 'policy', label: 'Policy Pass', value: `${policyPassRate}%`, trend: 'Compliance', color: 'var(--status-success)' }
          ].map((stat, i) => (
            loading ? <SkeletonCard key={i} h="h-24" /> :
            <div key={i}
              onClick={() => stat.id === 'ci' && setShowGateSummary(true)}
              className={`bg-[var(--bg-card)] rounded-[12px] p-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between h-auto min-h-[100px] transition-all ${stat.id === 'ci' ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
            >
              <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: stat.color }}></div>

              {stat.id === 'quality' ? (
                <div className="flex flex-col h-full w-full">
                  <div className="flex justify-between items-start mb-1.5">
                    <h3 className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">QUALITY GATE</h3>
                    <div className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[7px] font-black text-[var(--text-secondary)] uppercase">Not computed</div>
                  </div>
                  
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] font-black text-[10px]">—</div>
                    <div>
                      <p className="text-[18px] font-black text-[var(--text-primary)] leading-none">0/100</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1 mb-1.5">
                    {['SECURITY', 'RELIABILITY', 'MAINTAINABILITY'].map(l => (
                      <div key={l} className="bg-[var(--bg-primary)] p-0.5 rounded border border-[var(--border-subtle)] text-center">
                        <p className="text-[5px] text-[var(--text-secondary)] uppercase truncate tracking-tighter">{l}</p>
                        <p className="text-[8px] font-black text-[var(--text-secondary)]">—</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto">
                    <div className="h-1 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--border-subtle)] w-0" />
                    </div>
                    <div className="flex justify-between text-[7px] font-bold text-[var(--text-secondary)] mt-0.5">
                      <span>F</span>
                      <span>A</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start">
                    <h3 className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{stat.label}</h3>
                    {individualErrors[stat.id] && (
                      <Activity size={14} />
                    )}
                  </div>

                  <div className="flex justify-between items-end mt-auto">
                    <div>
                      <span className="text-[18px] font-black text-[var(--text-primary)] leading-none">{stat.value}</span>
                      {stat.counts && <div className="text-[8px] font-bold text-[var(--text-secondary)] mt-0.5 opacity-80">{stat.counts}</div>}
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: stat.color }}>{stat.trend}</span>
                    </div>
                  </div>
                </>
              )}
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


      {/* Middle Section: Vulnerability Grid only */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {metrics.map((m, i) => (
          loading ? <SkeletonCard key={i} h="h-20" /> :
            <div key={i}
              onClick={() => {
                if (m.path?.includes('null')) return;
                m.path && navigate(m.path);
              }}
              className={`bg-[var(--bg-card)] rounded-[12px] p-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between ${!m.path ? 'cursor-default' : m.path.includes('null') ? 'cursor-wait opacity-80' : 'cursor-pointer group hover:scale-[1.02]'} transition-all`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                  <m.icon size={12} />
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
              <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-0.5 group-hover:text-[var(--accent-primary)] transition-colors">{m.label}</p>
              <div className="flex justify-between items-end mt-auto">
                <span className="text-[18px] font-black text-[var(--text-primary)] leading-none">{m.value}</span>
                <TrendingUp size={16} className="text-gray-300" />
              </div>
            </div>
        ))}
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Postural Health Breakdown */}
        <div className="flex flex-col">
          <PostureRoadmap compact ciGateRate={ciGateStats.rate} hasScans={latestScan !== null} />
        </div>

        {/* Top Issues Widget */}
        <div className="flex flex-col">
          {loading ? <SkeletonCard h="h-64" /> :
            <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-[13px] font-black uppercase italic tracking-wider">Top Issues</h3>
                <Link to="/issues" className="text-[10px] text-[var(--accent-primary)] uppercase font-black hover:underline transition-all">View all →</Link>
              </div>
              <div className="flex flex-col gap-1">
                {latestVulnerabilities.length > 0 ? latestVulnerabilities.map((v: any) => (
                  <div key={v.$id} className="flex items-center gap-3 py-3 border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-primary)]/20 transition-colors rounded-lg px-2 -mx-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: SEVERITY_COLOR[v.severity] ?? '#888' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-black truncate text-[var(--text-primary)]">{v.title || v.message}</p>
                      <p className="text-[10px] text-[var(--text-secondary)] font-mono truncate">{v.file?.split('/').pop() || 'unknown'}{v.line ? `:${v.line}` : ''}</p>
                    </div>
                    <span className="text-[10px] font-black flex-shrink-0 uppercase tracking-widest"
                      style={{ color: SEVERITY_COLOR[v.severity] ?? '#888' }}>
                      {v.severity}
                    </span>
                  </div>
                )) : (
                  <div className="text-center py-12 text-[11px] text-[var(--text-secondary)] uppercase tracking-widest">
                    No critical issues found
                  </div>
                )}
              </div>
            </div>
          }
        </div>
      </div>

    </div>
  </div>
  );
}
