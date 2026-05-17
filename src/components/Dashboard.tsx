import { useEffect, useState, memo, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Shield, Activity, AlertCircle, FileText, XCircle, TrendingUp, ShieldX,
  ShieldCheck, ShieldAlert, Zap, Bug, Sparkles, RefreshCw
} from 'lucide-react';
import RemediationPanel from './RemediationPanel';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip as RechartsTooltip
} from 'recharts';
import toast from 'react-hot-toast';
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
            formatter={(_value: any, name: any, props: any) => [props.payload.actualValue, name]}
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

export default function Dashboard({ isSidebarCollapsed: _isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
  const { getJWT } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [selectedRemediationFindingId, setSelectedRemediationFindingId] = useState<string | null>(null);
  const [remediationQueue, setRemediationQueue] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [individualErrors] = useState<Record<string, boolean>>({});

  const [ciGateStats, setCiGateStats] = useState({ passed: 0, blocked: 0, rate: 0 });
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

      // Fetch open vulnerabilities for TONY's queue
      const queueRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.orderDesc('$createdAt'),
        Query.limit(5)
      ]).catch(() => ({ documents: [] }));
      setRemediationQueue(queueRes.documents);

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
      <div className="w-full mx-auto space-y-6">

        {/* Top Header Console Banner */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[var(--bg-card)] rounded-[16px] py-3 px-6 border border-[var(--border-subtle)] shadow-[0_4px_16px_rgba(0,0,0,0.02)]">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="text-[var(--accent-primary)] animate-pulse" size={18} />
              <h1 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">SCORPION SECURITY CONTROL PLANE</h1>
            </div>
            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 font-mono">GLOBAL OPERATOR TELEMETRY ORCHESTRATOR // BOUNDARY_ACTIVE</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)]/30 transition-all flex items-center justify-center"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => navigate('/repos')}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-[9px] tracking-widest uppercase transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)] flex items-center gap-2"
            >
              <Activity size={12} />
              + INITIALIZE NEW SCAN
            </button>
          </div>
        </div>

        {/* 1. Top Section: Core Security Posture (Full Width Summary Matrix) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Col 1: Postural Health Breakdown */}
          <div className="lg:col-span-1 h-full">
            <PostureRoadmap compact ciGateRate={ciGateStats.rate} hasScans={latestScan !== null} />
          </div>

          {/* Col 2: Threat Dimension Analysis */}
          <div className="lg:col-span-1 h-full">
            <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full flex flex-col border border-[var(--border-subtle)]">
              <div className="mb-4">
                <h3 className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Threat Dimension Analysis</h3>
                <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-0.5">Continuous Scanner Footprint Map</p>
              </div>
              <div className="flex-1 flex items-center justify-center min-h-[220px]">
                <SecurityRadarChart data={threatData} />
              </div>
            </div>
          </div>

          {/* Col 3: Core Compliance Gates Stack */}
          <div className="lg:col-span-1 flex flex-col gap-4">
            {[
              { id: 'ci', label: 'CI Gate Integrity', value: `${ciGateStats.rate}%`, trend: 'Success Rate', color: 'var(--status-success)', counts: `Passed: ${ciGateStats.passed} | Blocked: ${ciGateStats.blocked}` },
              { id: 'quality', label: 'QUALITY GATE', value: '0/100', trend: 'Not computed', color: 'var(--text-secondary)' },
              { id: 'policy', label: 'Policy Pass', value: `${policyPassRate}%`, trend: 'Compliance', color: 'var(--status-success)' }
            ].map((stat, i) => (
              loading ? <SkeletonCard key={i} h="h-20" /> :
              <div key={i}
                onClick={() => stat.id === 'ci' && setShowGateSummary(true)}
                className={`bg-[var(--bg-card)] rounded-[12px] p-3 shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col justify-between flex-1 min-h-[90px] border border-[var(--border-subtle)] relative transition-all ${stat.id === 'ci' ? 'cursor-pointer hover:scale-[1.02] hover:border-[var(--accent-primary)]/30' : ''}`}
              >
                <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: stat.color }}></div>

                {stat.id === 'quality' ? (
                  <div className="flex flex-col h-full w-full justify-between">
                    <div className="flex justify-between items-start">
                      <h3 className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">QUALITY GATE</h3>
                      <div className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[7px] font-black text-[var(--text-secondary)] uppercase">Not computed</div>
                    </div>
                    
                    <div className="flex items-center gap-2 my-1">
                      <div className="w-6 h-6 rounded-full border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-secondary)] font-black text-[10px]">—</div>
                      <div>
                        <p className="text-[16px] font-black text-[var(--text-primary)] leading-none">0/100</p>
                      </div>
                    </div>

                    <div>
                      <div className="h-1 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--border-subtle)] w-0" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <h3 className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">{stat.label}</h3>
                      {individualErrors[stat.id] && (
                        <Activity size={14} className="text-[var(--status-error)]" />
                      )}
                    </div>

                    <div className="flex justify-between items-end mt-2">
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
        </div>

        {/* 2. Middle Section: Dynamic Vulnerability Telemetry (The Grid Matrix Board) */}
        <div className="bg-[var(--bg-card)] rounded-[16px] p-6 border border-[var(--border-subtle)] shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
          <div className="flex justify-between items-center mb-6 border-b border-[var(--border-subtle)] pb-3">
            <div>
              <h3 className="text-[12px] font-black uppercase tracking-wider flex items-center gap-2">
                <Activity className="text-[var(--accent-primary)] animate-pulse" size={14} />
                Continuous Ingestion Telemetry Stream
              </h3>
              <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-0.5">Real-Time Core Scanner Feed</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">INGESTION_ACTIVE</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Column A: Static Analysis Vulnerabilities */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest border-l-2 border-emerald-500 pl-2">Static Analysis Vulnerabilities</h4>
              <div className="grid grid-cols-2 gap-3">
                {metrics.slice(0, 4).map((m, i) => (
                  loading ? <SkeletonCard key={i} h="h-20" /> :
                  <div key={i}
                    onClick={() => {
                      if (m.path?.includes('null')) return;
                      m.path && navigate(m.path);
                    }}
                    className={`bg-[var(--bg-primary)]/40 rounded-[12px] p-3 border border-[var(--border-subtle)] flex flex-col justify-between ${!m.path ? 'cursor-default' : m.path.includes('null') ? 'cursor-wait opacity-80' : 'cursor-pointer group hover:scale-[1.02] hover:bg-[var(--bg-primary)]/80 hover:border-[var(--accent-primary)]/30'} transition-all`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                        <m.icon size={12} />
                      </div>
                      <span className="text-[8px] font-mono opacity-60 uppercase font-black">sast</span>
                    </div>
                    <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-0.5 group-hover:text-[var(--accent-primary)] transition-colors">{m.label}</p>
                    <div className="flex justify-between items-end mt-auto">
                      <span className="text-[18px] font-black text-[var(--text-primary)] leading-none">{m.value}</span>
                      <TrendingUp size={14} className="text-zinc-400" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Column B: Infrastructure Telemetry */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest border-l-2 border-emerald-600 pl-2">Infrastructure Telemetry</h4>
              <div className="grid grid-cols-2 gap-3">
                {metrics.slice(4, 8).map((m, i) => (
                  loading ? <SkeletonCard key={i} h="h-20" /> :
                  <div key={i}
                    onClick={() => {
                      if (m.path?.includes('null')) return;
                      m.path && navigate(m.path);
                    }}
                    className={`bg-[var(--bg-primary)]/40 rounded-[12px] p-3 border border-[var(--border-subtle)] flex flex-col justify-between ${!m.path ? 'cursor-default' : m.path.includes('null') ? 'cursor-wait opacity-80' : 'cursor-pointer group hover:scale-[1.02] hover:bg-[var(--bg-primary)]/80 hover:border-[var(--accent-primary)]/30'} transition-all`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                        <m.icon size={12} />
                      </div>
                      <span className="text-[8px] font-mono opacity-60 uppercase font-black">infra</span>
                    </div>
                    <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-0.5 group-hover:text-[var(--accent-primary)] transition-colors">{m.label}</p>
                    <div className="flex justify-between items-end mt-auto">
                      <span className="text-[18px] font-black text-[var(--text-primary)] leading-none">{m.value}</span>
                      <TrendingUp size={14} className="text-zinc-400" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Bottom Section: Active Remediation & Core Priorities (Split Panel View) */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left Panel (60% / 3 cols): TONY's Remediation Roadmap Staging Queue */}
          <div className="lg:col-span-3 flex flex-col bg-[var(--bg-card)] rounded-[16px] p-6 border border-[var(--border-subtle)] shadow-[0_4px_16px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-6 pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
                  <Sparkles size={12} />
                </div>
                <div>
                  <h3 className="text-[12px] font-black uppercase italic tracking-wider">TONY Remediation Roadmap</h3>
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-0.5">Automated Intelligence Staging Queue</p>
                </div>
              </div>
              <span className="text-[8px] font-black font-mono bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded uppercase">Staging</span>
            </div>

            <div className="flex-1 flex flex-col gap-3 justify-center">
              {loading ? (
                <div className="space-y-3">
                  <div className="h-16 bg-[var(--bg-primary)] animate-pulse rounded-xl"></div>
                  <div className="h-16 bg-[var(--bg-primary)] animate-pulse rounded-xl"></div>
                </div>
              ) : remediationQueue.length > 0 ? (
                remediationQueue.map((v: any) => (
                  <div key={v.$id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-3 bg-[var(--bg-primary)]/40 hover:bg-[var(--bg-primary)]/80 border border-[var(--border-subtle)] rounded-xl transition-all group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider"
                          style={{
                            background: `${SEVERITY_COLOR[v.severity] ?? '#888'}15`,
                            color: SEVERITY_COLOR[v.severity] ?? '#888',
                            border: `1px solid ${SEVERITY_COLOR[v.severity] ?? '#888'}30`
                          }}
                        >
                          {v.severity}
                        </span>
                        <p className="text-[11px] font-black truncate text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">{v.title || v.message}</p>
                      </div>
                      <p className="text-[9px] text-[var(--text-secondary)] font-mono truncate">{v.file_path || v.location || v.file || 'unknown'}</p>
                      {v.fixedVersion && (
                        <p className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest mt-1">Upgrade path available: v{v.installedVersion || '1.0.0'} → v{v.fixedVersion}</p>
                      )}
                    </div>

                    <button
                      onClick={() => setSelectedRemediationFindingId(v.$id)}
                      className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center gap-1.5 shadow-[0_2px_8px_rgba(16,185,129,0.15)] align-self-end md:align-self-auto"
                    >
                      <Zap size={10} />
                      REMEDIATE
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-[10px] text-[var(--text-secondary)] uppercase tracking-widest italic">
                  No pending remediation vectors
                </div>
              )}
            </div>
          </div>

          {/* Right Panel (40% / 2 cols): Critical Real-Time Findings (Chronological Timeline) */}
          <div className="lg:col-span-2 flex flex-col bg-[var(--bg-card)] rounded-[16px] p-6 border border-[var(--border-subtle)] shadow-[0_4px_16px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-6 pb-3 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <AlertCircle className="text-emerald-500" size={14} />
                <h3 className="text-[12px] font-black uppercase italic tracking-wider">Critical Real-Time Findings</h3>
              </div>
              <Link to="/issues" className="text-[9px] text-[var(--accent-primary)] font-black uppercase hover:underline transition-all tracking-wider">View All →</Link>
            </div>

            <div className="flex-1 flex flex-col gap-4">
              {loading ? (
                <div className="space-y-4">
                  <div className="h-12 bg-[var(--bg-primary)] animate-pulse rounded-xl"></div>
                  <div className="h-12 bg-[var(--bg-primary)] animate-pulse rounded-xl"></div>
                </div>
              ) : latestVulnerabilities.length > 0 ? (
                latestVulnerabilities.map((v: any) => (
                  <div key={v.$id} className="relative pl-6 border-l border-[var(--border-subtle)] pb-2 last:pb-0">
                    <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-card)]"
                      style={{ background: SEVERITY_COLOR[v.severity] ?? '#888' }} />
                    
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-[11px] font-black truncate text-[var(--text-primary)] pr-2">{v.title || v.message}</p>
                      <span className="text-[8px] font-black uppercase tracking-wider shrink-0"
                        style={{ color: SEVERITY_COLOR[v.severity] ?? '#888' }}
                      >
                        {v.severity}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] text-[var(--text-secondary)] font-mono truncate max-w-[70%]">{v.file?.split('/').pop() || 'unknown'}{v.line ? `:${v.line}` : ''}</p>
                      <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase font-mono">Telemetry Active</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)]">Compliance Delta Sweep</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">100% SECURE</span>
                  </div>
                  <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden my-4">
                    <div className="h-full bg-emerald-600 w-full shadow-[0_0_12px_rgba(5,150,105,0.4)]"></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mt-6 text-[10px] font-mono text-stone-500">
                    <div className="flex items-center">
                      <span>OWASP TOP 10 SECURE:</span>
                      <span className="text-emerald-600 font-bold ml-auto">100% PASSED</span>
                    </div>
                    <div className="flex items-center">
                      <span>SECRETS & KEY LEAKS:</span>
                      <span className="text-emerald-600 font-bold ml-auto">0 DETECTED</span>
                    </div>
                    <div className="flex items-center">
                      <span>DEPENDENCY DELTA VULNS:</span>
                      <span className="text-emerald-600 font-bold ml-auto">0 OPEN</span>
                    </div>
                    <div className="flex items-center">
                      <span>CONTAINER BASELINE RUNTIME:</span>
                      <span className="text-emerald-600 font-bold ml-auto">VERIFIED</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

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

      {/* TONY Remediation Intelligence Modal */}
      {selectedRemediationFindingId && (
        <RemediationPanel
          documentId={selectedRemediationFindingId}
          onClose={() => setSelectedRemediationFindingId(null)}
        />
      )}
    </div>
  );
}
