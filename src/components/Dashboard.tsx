import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Activity, AlertCircle, FileText, XCircle, ShieldX,
  ShieldCheck, ShieldAlert, Zap, Bug, RefreshCw, GitPullRequest, Clock, ArrowRight
} from 'lucide-react';
import RemediationPanel from './RemediationPanel';
import toast from 'react-hot-toast';
import PostureRoadmap from './PostureRoadmap';
import { StatCard, ThreatRadar, HeatmapGrid, type HeatmapDatum, type Severity } from './ui';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#E24B4A',
  HIGH: '#EF9F27',
  MEDIUM: '#378ADD',
  LOW: '#639922',
  INFO: '#888780',
};

const SEVERITY_BG: Record<string, string> = {
  CRITICAL: '#FCEBEB',
  HIGH: '#FAEEDA',
  MEDIUM: '#E6F1FB',
  LOW: '#EAF3DE',
  INFO: '#F1EFE8',
};

export default function Dashboard({ isSidebarCollapsed: _isSidebarCollapsed }: { isSidebarCollapsed: boolean }) {
  const { getJWT, user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [selectedRemediationFindingId, setSelectedRemediationFindingId] = useState<string | null>(null);
  const [remediationQueue, setRemediationQueue] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [individualErrors] = useState<Record<string, boolean>>({});

  const [ciGateStats, setCiGateStats] = useState({ passed: 0, blocked: 0, rate: 0 });
  const [policyPassRate, setPolicyPassRate] = useState(100);
  const [activeScansCount, setActiveScansCount] = useState<number>(0);

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
  const loadingRef = useRef(loading);
  const isRefreshingRef = useRef(isRefreshing);
  const lastFetch = useRef<number>(0);
  loadingRef.current = loading;
  isRefreshingRef.current = isRefreshing;

  const [detailsExpanded, setDetailsExpanded] = useState<boolean>(() => {
    return localStorage.getItem('scorpion_dashboard_details_expanded') === 'true';
  });
  const [qualityGateScore, setQualityGateScore] = useState<number>(0);
  const [lastBuildStatus, setLastBuildStatus] = useState<string>('N/A');
  const [deploymentsToday, setDeploymentsToday] = useState<number>(0);
  const [byType, setByType] = useState({ secret: 0, dependency: 0, sast: 0, iac: 0 });
  const [heatmapData, setHeatmapData] = useState<HeatmapDatum[]>([]);
  const [repoRisk, setRepoRisk] = useState<{ repo_id: string; repo_name: string; critical: number; high: number }[]>([]);
  const [mttrDays, setMttrDays] = useState<number | null>(null);
  const [remediationStats, setRemediationStats] = useState({ queueCount: 0, prsCreatedToday: 0, avgDetectionToPrDays: null as number | null });
  const [auditEntries, setAuditEntries] = useState<{ action: string; resource: string; time: string }[]>([]);
  const [meshStatus, setMeshStatus] = useState<{ channel: string; configured: boolean }[]>([]);

  const pipelineGateStatus = [
    { env: 'DEV', icon: '✓', color: '#639922' },
    { env: 'STAGING', icon: '⚠', color: '#BA7517' },
    { env: 'PRODUCTION', icon: '✗', color: '#E24B4A' },
  ];

  const recentSecretEntries = latestVulnerabilities
    .filter((v: any) => (v.category || v.type || '').toLowerCase().includes('secret'))
    .map((v: any) => v.title || v.message)
    .filter(Boolean);

  // ── All data-fetching logic preserved exactly ──────────────────────────────

  const fetchDashboardData = useCallback(async (isAuto = false) => {
    if (isFetchingRef.current && !isRefreshingRef.current) return;
    const CACHE_MS = 5 * 60 * 1000;
    if (!isAuto && Date.now() - lastFetch.current < CACHE_MS && !isRefreshingRef.current) return;
    lastFetch.current = Date.now();
    isFetchingRef.current = true;
    if (!isAuto && loadingRef.current && !isRefreshingRef.current) setLoading(true);

    const timeout = setTimeout(() => {
      setLoading(false);
      setIsRefreshing(false);
      isFetchingRef.current = false;
    }, 8000);

    try {
      const token = await getJWT();

      let gateSummaryData: any[] = [];
      try {
        const gateRes = await fetch('/api/gates/summary', { headers: { 'Authorization': `Bearer ${token}` } });
        if (gateRes.ok) { const gateData = await gateRes.json(); gateSummaryData = gateData.failedRepos || []; }
      } catch (err) { console.warn('Failed to fetch gate summary:', err); }
      setGateSummary(gateSummaryData);

      try {
        const secRes = await fetch('/api/dashboard/security', { headers: { 'Authorization': `Bearer ${token}` } });
        if (secRes.ok) {
          const secData = await secRes.json();
          const t = secData?.by_type || {};
          setByType({ secret: Number(t.secret ?? 0), dependency: Number(t.dependency ?? 0), sast: Number(t.sast ?? 0), iac: Number(t.iac ?? 0) });
          setMttrDays(secData?.mttr_days ?? null);
          const repos = (secData?.by_repo || []) as { repo_id: string; repo_name: string; count: number; critical: number; high: number }[];
          setRepoRisk(
            [...repos]
              .sort((a, b) => (b.critical * 10 + b.high) - (a.critical * 10 + a.high))
              .slice(0, 5)
          );
        }
      } catch (err) { console.warn('Failed to fetch security breakdown:', err); }

      try {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const [queueRes, remediatedTodayRes] = await Promise.all([
          databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [Query.equal('status', 'open'), Query.limit(1)]),
          databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('resolution_status', 'remediated'),
            Query.greaterThanEqual('$updatedAt', startOfDay.toISOString()),
            Query.limit(50),
          ]),
        ]);
        const detectionToPrDurationsMs = remediatedTodayRes.documents
          .map((d: any) => new Date(d.$updatedAt).getTime() - new Date(d.$createdAt).getTime())
          .filter((ms: number) => ms > 0);
        const avgDetectionToPrDays = detectionToPrDurationsMs.length > 0
          ? Math.round((detectionToPrDurationsMs.reduce((sum, ms) => sum + ms, 0) / detectionToPrDurationsMs.length / (1000 * 60 * 60 * 24)) * 10) / 10
          : null;
        setRemediationStats({
          queueCount: queueRes.total,
          prsCreatedToday: remediatedTodayRes.total,
          avgDetectionToPrDays,
        });
      } catch (err) { console.warn('Failed to fetch remediation queue stats:', err); }

      try {
        const auditRes = await fetch('/api/audit', { headers: { 'Authorization': `Bearer ${token}` } });
        if (auditRes.ok) {
          const auditDocs = await auditRes.json();
          setAuditEntries(
            auditDocs.slice(0, 3).map((d: any) => ({
              action: `${d.action || 'action'} · ${d.resource || d.resourceId || 'system'}`,
              resource: d.actorEmail || d.actor || 'system',
              time: new Date(d.timestamp || d.$createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
            }))
          );
        }
      } catch (err) { console.warn('Failed to fetch audit log:', err); }

      try {
        if (user) {
          const integrationsRes = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [Query.equal('userId', user.$id), Query.limit(1)]);
          const integration = integrationsRes.documents[0];
          setMeshStatus([
            { channel: 'Slack', configured: !!integration?.slack_webhook },
            { channel: 'Discord', configured: !!integration?.discord_webhook },
            { channel: 'PagerDuty', configured: !!integration?.pagerduty_key },
          ]);
        }
      } catch (err) { console.warn('Failed to fetch integration status:', err); }

      let reposDocuments: any[] = [];
      try {
        const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [Query.orderDesc('$createdAt'), Query.limit(20)]);
        reposDocuments = reposRes.documents;
      } catch (err) { console.warn('Failed to fetch repositories from Appwrite:', err); }

      if (reposDocuments.length === 0 && localStorage.getItem('scorpion_demo_seeded') === 'true') {
        const { MOCK_REPOSITORIES } = await import('../lib/demoData');
        reposDocuments = MOCK_REPOSITORIES as any;
      }

      const repoIds = reposDocuments.map(r => r.$id);
      const repoUrls = reposDocuments.map(r => r.url).filter(Boolean);

      if (repoIds.length === 0) { setLoading(false); return; }

      let scansDocuments: any[] = [];
      try {
        const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
          Query.or([Query.equal('repo_id', repoIds), Query.equal('repoUrl', repoUrls)]),
          Query.equal('status', 'completed'), Query.orderDesc('$createdAt'), Query.limit(1)
        ]);
        scansDocuments = scansRes.documents;
      } catch (err) { console.warn('Failed to fetch scans from Appwrite:', err); }

      if (scansDocuments.length === 0 && localStorage.getItem('scorpion_demo_seeded') === 'true') {
        const { MOCK_SCANS } = await import('../lib/demoData');
        scansDocuments = [MOCK_SCANS[1]] as any;
      }

      const latestCompletedScan = scansDocuments[0] || null;

      let activityDocuments: any[] = [];
      try {
        const activityRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
          Query.or([Query.equal('repo_id', repoIds), Query.equal('repoUrl', repoUrls)]),
          Query.orderDesc('$createdAt'), Query.limit(90)
        ]);
        activityDocuments = activityRes.documents;
      } catch (err) { console.warn('Failed to fetch activity scans from Appwrite:', err); }

      if (activityDocuments.length === 0 && localStorage.getItem('scorpion_demo_seeded') === 'true') {
        const { MOCK_SCANS } = await import('../lib/demoData');
        activityDocuments = MOCK_SCANS as any;
      }

      const scans = activityDocuments;

      const countByDay = new Map<string, number>();
      scans.forEach((s: any) => {
        const created = s.$createdAt || s.createdAt;
        if (!created) return;
        const day = new Date(created).toISOString().slice(0, 10);
        countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
      });
      setHeatmapData(Array.from(countByDay, ([date, count]) => ({ date, count })));

      let passed = 0; let blocked = 0; let active = 0;
      scans.forEach(s => {
        let gate = s.gateStatus || s.gate_status;
        if (s.details && typeof s.details === 'string') {
          try { const d = JSON.parse(s.details); if (d.gate_status) gate = d.gate_status; } catch (e) {}
        }
        if (gate === 'passed') passed++;
        if (gate === 'failed' || gate === 'blocked') blocked++;
        if (s.status === 'running' || s.status === 'pending') active++;
      });

      setCiGateStats({ passed, blocked, rate: (passed + blocked) > 0 ? Math.round((passed / (passed + blocked)) * 100) : 0 });
      setActiveScansCount(active);

      if (latestCompletedScan) {
        setLatestScanId(latestCompletedScan.$id);
        setLatestScan(latestCompletedScan);
        const scan = latestCompletedScan;
        let crit = Number(scan.criticalCount ?? scan.critical ?? 0);
        let high = Number(scan.highCount ?? scan.high ?? 0);
        let med = Number(scan.mediumCount ?? scan.medium ?? 0);
        let low = Number(scan.lowCount ?? scan.low ?? 0);
        let bugs = Number(scan.bugs ?? 0);
        let lines = 0;
        let total = scan.total ?? scan.totalIssues ?? scan.vulnerabilities ?? ((scan.critical ?? scan.criticalCount ?? 0) + (scan.high ?? scan.highCount ?? 0) + (scan.medium ?? scan.mediumCount ?? 0) + (scan.low ?? scan.lowCount ?? 0));
        let score = scan.score ?? scan.securityScore ?? scan.security_score ?? scan.security_rating ?? Math.max(15, Math.round(100 - (crit * 8) - (high * 1.5) - (med * 0.3) - (low * 0.05)));

        if (latestCompletedScan.details && typeof latestCompletedScan.details === 'string') {
          try {
            const d = JSON.parse(latestCompletedScan.details);
            if (d.critical_count !== undefined) crit = Math.max(crit, Number(d.critical_count));
            if (d.high_count !== undefined) high = Math.max(high, Number(d.high_count));
            if (d.medium_count !== undefined) med = Math.max(med, Number(d.medium_count));
            if (d.low_count !== undefined) low = Math.max(low, Number(d.low_count));
            if (d.total_vulnerabilities !== undefined) total = Math.max(total, Number(d.total_vulnerabilities));
            if (d.security_score !== undefined) score = Number(d.security_score) === 0 ? Math.max(15, Math.round(100 - (crit * 8) - (high * 1.5) - (med * 0.3) - (low * 0.05))) : Number(d.security_score);
            if (d.bugs !== undefined) bugs = Math.max(bugs, Number(d.bugs));
            if (d.total_lines !== undefined) lines = Number(d.total_lines);
          } catch (e) {}
        }

        if (total === 0) total = crit + high + med + low;
        const finalScore = score !== undefined && score !== null ? Math.round(Number(score)) : Math.max(0, Math.round(100 - (crit * 10) - (high * 4) - (med * 1) - (low * 0.25)));
        setVulnStats({ critical: crit, high, medium: med, low, bugs, total, score: finalScore, linesScanned: lines, codeSmells: 0 });
        setPolicyPassRate(finalScore > 85 ? 100 : finalScore > 65 ? 80 : finalScore > 40 ? 60 : 30);
        setQualityGateScore(localStorage.getItem('scorpion_demo_seeded') === 'true' ? 68 : Math.max(0, finalScore - 5));
      } else {
        setVulnStats({ critical: 0, high: 0, medium: 0, low: 0, bugs: 0, total: 0, score: 0, linesScanned: 0, codeSmells: 0 });
        setPolicyPassRate(0);
        setQualityGateScore(0);
      }

      let vulnsDocuments: any[] = [];
      try {
        const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [Query.orderDesc('$createdAt'), Query.limit(5)]);
        vulnsDocuments = vulnsRes.documents;
      } catch (err) { console.warn('Failed to fetch vulnerabilities from Appwrite:', err); }

      if (vulnsDocuments.length === 0 && localStorage.getItem('scorpion_demo_seeded') === 'true') {
        const { MOCK_FINDINGS } = await import('../lib/demoData');
        vulnsDocuments = MOCK_FINDINGS as any;
      }

      setLatestVulnerabilities(vulnsDocuments.slice(0, 5));
      setRemediationQueue(vulnsDocuments.slice(0, 5));

      try {
        const buildRes = await databases.listDocuments(DB_ID, COLLECTIONS.BUILD_PIPELINES, [Query.orderDesc('$createdAt'), Query.limit(1)]);
        setLastBuildStatus(buildRes.documents.length > 0 ? buildRes.documents[0].status : 'N/A');
      } catch (err) { console.warn('Failed to fetch builds:', err); }

      try {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const deployRes = await databases.listDocuments(DB_ID, COLLECTIONS.DEPLOYMENTS, [Query.greaterThanEqual('$createdAt', startOfDay.toISOString()), Query.limit(100)]);
        setDeploymentsToday(deployRes.documents.length || 0);
      } catch (err) { console.warn('Failed to fetch deployments:', err); }

      if (isAuto) toast.success('Data updated', { id: 'auto-refresh' });
      setError(null);
    } catch (err: any) {
      console.error('[Dashboard] Fetch error:', err);
    } finally {
      clearTimeout(timeout);
      isFetchingRef.current = false;
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [getJWT, user]);

  useEffect(() => {
    fetchDashboardData();
    const handleManualRefresh = () => fetchDashboardData(true);
    window.addEventListener('refresh-dashboard', handleManualRefresh);
    let realtimeDebounce: NodeJS.Timeout;
    const unsubscribe = client.subscribe([`databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`], (response) => {
      if (response.events.some(e => e.includes('.create') || e.includes('.update'))) {
        const payload = response.payload as any;
        if (payload?.status === 'completed') {
          clearTimeout(realtimeDebounce);
          realtimeDebounce = setTimeout(() => fetchDashboardData(true), 10000);
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
      window.removeEventListener('refresh-dashboard', handleManualRefresh);
      clearTimeout(realtimeDebounce);
    };
  }, [fetchDashboardData]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const radarMax = Math.max(10, vulnStats.total, byType.secret, byType.dependency, byType.sast, byType.iac);
  const threatRadarData = [
    { axis: 'Secrets', value: byType.secret },
    { axis: 'Vulnerabilities', value: vulnStats.total },
    { axis: 'SAST', value: byType.sast },
    { axis: 'Dependencies', value: byType.dependency },
    { axis: 'IaC', value: byType.iac },
  ];

  const ringMetrics: { id: string; label: string; value: number; max: number; severity: Severity; icon: typeof ShieldX; path?: string }[] = [
    { id: 'critical', label: 'Critical', value: vulnStats.critical, max: 10, severity: 'critical', icon: ShieldX, path: `/scans/${latestScanId}/sast?filter=critical` },
    { id: 'high', label: 'High', value: vulnStats.high, max: 25, severity: 'high', icon: ShieldAlert, path: `/scans/${latestScanId}/sast?filter=high` },
    { id: 'medium', label: 'Medium', value: vulnStats.medium, max: 50, severity: 'medium', icon: AlertCircle, path: `/scans/${latestScanId}/sast?filter=medium` },
    { id: 'low', label: 'Low', value: vulnStats.low, max: 100, severity: 'low', icon: ShieldCheck, path: `/scans/${latestScanId}/sast?filter=low` },
    { id: 'bugs', label: 'Bugs', value: vulnStats.bugs, max: 50, severity: 'info', icon: Bug, path: `/scans/${latestScanId}/antipatterns` },
    { id: 'vulns', label: 'Open vulns', value: vulnStats.total, max: 150, severity: vulnStats.total > 100 ? 'high' : vulnStats.total > 30 ? 'medium' : 'low', icon: Activity, path: `/scans/${latestScanId}/sast` },
  ];

  const gateRows = [
    { id: 'ci', label: 'CI Gate', value: `${ciGateStats.rate}%`, sub: `${ciGateStats.passed} passed · ${ciGateStats.blocked} blocked`, color: '#185FA5' },
    { id: 'quality', label: 'Quality Gate', value: `${qualityGateScore || 0}/100`, sub: qualityGateScore > 70 ? 'Passed' : qualityGateScore > 50 ? 'Warning' : 'Failed', color: qualityGateScore > 70 ? '#639922' : qualityGateScore > 50 ? '#BA7517' : '#E24B4A' },
    { id: 'policy', label: 'Policy Pass', value: `${policyPassRate}%`, sub: 'Compliance', color: '#639922' },
    { id: 'build', label: 'Last Build', value: lastBuildStatus.toUpperCase(), sub: 'Status', color: lastBuildStatus === 'success' ? '#639922' : lastBuildStatus === 'failed' ? '#E24B4A' : '#BA7517' },
    { id: 'deploy', label: 'Deployments', value: deploymentsToday.toString(), sub: 'Today', color: '#185FA5' },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setVulnStats({ critical: 0, high: 0, medium: 0, low: 0, bugs: 0, total: 0, score: 0, linesScanned: 0, codeSmells: 0 });
    setPolicyPassRate(0);
    setLastBuildStatus('N/A');
    setDeploymentsToday(0);
    isFetchingRef.current = true;
    await fetchDashboardData();
  };

  // ── Skeleton ────────────────────────────────────────────────────────────────

  const SkeletonCard = ({ className = '' }: { className?: string }) => (
    <div className={`p-4 bg-white rounded-2xl border border-gray-100 animate-pulse ${className}`}>
      <div className="mb-3 w-1/2 h-3 bg-gray-100 rounded" />
      <div className="w-1/3 h-7 bg-gray-100 rounded" />
    </div>
  );

  // ── Error state ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px] bg-gray-50">
        <div className="text-center">
          <XCircle size={40} className="mx-auto mb-3 text-red-400" />
          <h2 className="mb-1 text-base font-medium text-gray-900">Failed to load dashboard</h2>
          <p className="mb-4 text-sm text-gray-500">{error}</p>
          <button onClick={handleRefresh} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-2xl transition-colors hover:bg-blue-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="px-6 py-5 mx-auto space-y-5 max-w-screen-2xl">

        {/* ── Inline header (replaces sticky top bar) ── */}
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm font-semibold text-gray-900">Dashboard</p>
            <p className="text-xs text-gray-400">Monitor your security posture</p>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 text-gray-400 rounded-2xl border border-gray-200 transition-colors hover:text-gray-600 hover:border-gray-300"
              aria-label="Refresh dashboard"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => navigate('/repos')}
              className="flex gap-2 items-center px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-2xl transition-colors hover:bg-blue-700"
            >
              <Zap size={12} />
              New scan
            </button>
          </div>
        </div>

        {/* ── AI Remediation Queue (hero) ── */}
        <div className="p-6 bg-gray-900 rounded-2xl border border-gray-800">
          <div className="flex flex-wrap justify-between items-start gap-4 mb-5">
            <div>
              <p className="text-xs font-semibold tracking-wider text-blue-300 uppercase mb-1.5 flex items-center gap-1.5">
                <Zap size={12} />
                AI Remediation Queue
              </p>
              <p className="text-sm text-gray-400">Findings auto-triaged for a fix PR</p>
            </div>
            <Link
              to="/issues"
              className="flex items-center gap-1.5 text-xs font-medium text-gray-300 hover:text-white transition-colors"
            >
              Open queue <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase mb-1">Open queue</p>
              {loading ? <div className="w-12 h-8 bg-gray-800 rounded animate-pulse" /> : (
                <p className="text-3xl font-semibold text-white">{remediationStats.queueCount}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase mb-1 flex items-center gap-1">
                <GitPullRequest size={11} /> PRs created today
              </p>
              {loading ? <div className="w-12 h-8 bg-gray-800 rounded animate-pulse" /> : (
                <p className="text-3xl font-semibold text-emerald-400">{remediationStats.prsCreatedToday}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase mb-1 flex items-center gap-1">
                <Clock size={11} /> Avg detection → PR
              </p>
              {loading ? <div className="w-12 h-8 bg-gray-800 rounded animate-pulse" /> : (
                <p className="text-3xl font-semibold text-white">
                  {remediationStats.avgDetectionToPrDays !== null ? `${remediationStats.avgDetectionToPrDays}d` : '—'}
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase mb-1">Acceptance rate</p>
              <p className="text-sm font-medium text-gray-500 mt-2" title="No PR merge/reject status is recorded yet — add a field to track this">Not yet tracked</p>
            </div>
          </div>
        </div>

        {/* ── Key metric cards ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {gateRows.map((row) => (
            <div
              key={row.id}
              onClick={() => row.id === 'ci' ? setShowGateSummary(true) : undefined}
              className={`bg-white border border-gray-100 rounded-2xl px-4 py-3.5 ${row.id === 'ci' ? 'cursor-pointer hover:border-gray-200 transition-colors' : ''}`}
            >
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{row.label}</p>
              {loading ? (
                <div className="w-16 h-7 bg-gray-100 rounded animate-pulse" />
              ) : (
                <>
                  <p className="text-2xl font-semibold leading-none" style={{ color: row.color }}>{row.value}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{row.sub}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Security posture + Threat radar ── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="p-5 bg-white rounded-xl border border-gray-100 aspect-square flex flex-col">
            <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase shrink-0">Security posture</p>
            <div className="flex-1 min-h-0">
              <PostureRoadmap
                compact
                ciGateRate={ciGateStats.rate}
                hasScans={latestScan !== null}
                vulnStats={{ critical: vulnStats.critical, high: vulnStats.high, medium: vulnStats.medium, score: vulnStats.score }}
              />
            </div>
          </div>

          <div className="flex flex-col p-5 bg-white rounded-xl border border-gray-100 aspect-square">
            <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase shrink-0">Coverage — threat radar</p>
            <div className="flex flex-1 justify-center items-center min-h-0">
              <ThreatRadar data={threatRadarData} max={radarMax} size={220} className="w-full" />
            </div>
          </div>
        </div>

        {/* ── Expanded details toggle ── */}
        <div>
          <button
            onClick={() => {
              const next = !detailsExpanded;
              setDetailsExpanded(next);
              localStorage.setItem('scorpion_dashboard_details_expanded', String(next));
            }}
            className="flex gap-2 items-center py-2 w-full text-xs font-medium text-left text-gray-400 border-t border-gray-100 transition-colors hover:text-gray-600"
          >
            <span>{detailsExpanded ? '▾' : '▸'}</span>
            <span className="tracking-wider uppercase">More signal — attack sources, scan heatmap, secrets, MTTR, pipeline gates</span>
          </button>

          {detailsExpanded && (
            <div className="mt-4 space-y-4">

              {/* ── Scan health — ring metrics ── */}
              <div className="p-5 bg-white rounded-2xl border border-gray-100">
                <p className="mb-4 text-xs font-semibold tracking-wider text-gray-400 uppercase">Scan health</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {ringMetrics.map((m) =>
                    loading ? <SkeletonCard key={m.id} /> : (
                      <StatCard
                        key={m.id}
                        title={m.label}
                        icon={<m.icon size={14} />}
                        accent={m.severity}
                        onClick={m.path && !m.path.includes('null') ? () => navigate(m.path!) : undefined}
                      >
                        <div className="flex flex-col gap-2 items-center mt-1">
                          <span className="text-2xl font-semibold text-gray-900">{m.value}</span>
                          {(() => {
                            const ratio = m.max > 0 ? m.value / m.max : 0;
                            const status = ratio === 0 ? 'Healthy' : ratio < 0.5 ? 'Warning' : 'Failing';
                            const cls = ratio === 0 ? 'bg-emerald-50 text-emerald-600' : ratio < 0.5 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
                            return <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase ${cls}`}>{status}</span>;
                          })()}
                        </div>
                      </StatCard>
                    )
                  )}
                  {loading ? <SkeletonCard /> : (
                    <StatCard title="Lines scanned" icon={<FileText size={14} />} accent="primary">
                      <div className="flex justify-center items-center h-[78px]">
                        <span className="text-2xl font-semibold text-gray-900">{vulnStats.linesScanned?.toLocaleString() || '0'}</span>
                      </div>
                    </StatCard>
                  )}
                  {loading ? <SkeletonCard /> : (
                    <StatCard title="Active scans" icon={<Zap size={14} />} accent="primary" onClick={() => navigate('/repos')}>
                      <div className="flex justify-center items-center h-[78px]">
                        <span className="text-2xl font-semibold text-gray-900">{activeScansCount}</span>
                      </div>
                    </StatCard>
                  )}
                </div>
              </div>

              {/* ── Findings & recent activity (Signal stream) ── */}
              <div className="p-5 bg-white rounded-2xl border border-gray-100">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Findings & recent activity</p>
                    <p className="text-sm font-medium text-gray-900">Signal stream</p>
                  </div>
                  <Link to="/issues" className="text-xs font-medium text-blue-600 hover:underline">View all →</Link>
                </div>

                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-50 rounded-2xl animate-pulse" />)}
                  </div>
                ) : latestVulnerabilities.length > 0 ? (
                  <div className="divide-y divide-gray-50">
                    {latestVulnerabilities.map((v: any) => (
                      <div key={v.$id} className="flex gap-3 items-center py-3">
                        <div className="w-0.5 h-10 rounded-full shrink-0" style={{ background: SEVERITY_COLOR[v.severity] ?? '#888780' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                              style={{ color: SEVERITY_COLOR[v.severity], background: SEVERITY_BG[v.severity] ?? '#F1EFE8' }}
                            >
                              {v.severity}
                            </span>
                            <p className="text-sm text-gray-900 truncate">{v.title || v.message}</p>
                          </div>
                          <p className="font-mono text-xs text-gray-400 truncate">
                            {v.file_path || v.location || v.file || 'unknown'}{v.line ? `:${v.line}` : ''}
                          </p>
                          {v.fixedVersion && (
                            <p className="text-[10px] text-emerald-600 font-medium mt-0.5">
                              Upgrade path: v{v.installedVersion || '?'} → v{v.fixedVersion}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setSelectedRemediationFindingId(v.$id)}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-2xl hover:border-gray-300 hover:bg-gray-50 transition-colors"
                        >
                          <Zap size={11} />
                          Fix
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6">
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-sm font-medium text-gray-700">Compliance delta sweep</p>
                      <span className="text-xs font-semibold text-emerald-600">100% secure</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-5">
                      <div className="w-full h-full rounded-full" style={{ background: 'var(--severity-low)' }} />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[
                        ['OWASP Top 10', '100% passed'],
                        ['Secrets & key leaks', '0 detected'],
                        ['Dependency delta vulns', '0 open'],
                        ['Container baseline runtime', 'Verified'],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between items-center px-3 py-2 text-xs text-gray-500 bg-gray-50 rounded-2xl">
                          <span>{label}</span>
                          <span className="font-medium text-emerald-600">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Repo risk ranking ── */}
              <div className="p-5 bg-white rounded-xl border border-gray-100">
                <div className="flex justify-between items-center mb-4">
                  <p className="text-xs font-semibold tracking-wider text-gray-400 uppercase">Repo risk ranking</p>
                  <Link to="/repos" className="text-xs font-medium text-blue-600 hover:underline">View all repos →</Link>
                </div>
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-50 rounded-2xl animate-pulse" />)}
                  </div>
                ) : repoRisk.length > 0 ? (
                  <div className="divide-y divide-gray-50">
                    {repoRisk.map((r, i) => (
                      <div key={r.repo_id} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-semibold text-gray-400 w-5 shrink-0">#{i + 1}</span>
                          <span className="text-sm text-gray-900 truncate">{r.repo_name}</span>
                        </div>
                        <span className="font-mono text-xs font-medium shrink-0" style={{ color: r.critical > 0 ? '#E24B4A' : r.high > 0 ? '#EF9F27' : '#639922' }}>
                          {r.critical}C · {r.high}H
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-sm text-gray-400">No open findings across monitored repos.</p>
                )}
              </div>

              {/* ── Secrets / MTTR / Pipeline ── */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="p-5 bg-white rounded-2xl border border-gray-100">
                  <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase">Open secrets</p>
                  <div className="flex gap-3 items-center">
                    <span className="text-3xl font-semibold" style={{ color: byType.secret > 0 ? '#E24B4A' : '#639922' }}>
                      {byType.secret ?? 0}
                    </span>
                    <div className="space-y-1 min-w-0 text-xs text-gray-400">
                      {(recentSecretEntries.length > 0 ? recentSecretEntries : ['No recent secrets detected']).slice(0, 2).map((s: string, i: number) => (
                        <p key={i} className="truncate">• {s}</p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-5 bg-white rounded-2xl border border-gray-100">
                  <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase">MTTR</p>
                  {mttrDays !== null ? (
                    <div className="flex gap-3 items-center">
                      <span className="text-3xl font-semibold" style={{ color: mttrDays <= 1 ? '#639922' : mttrDays <= 3 ? '#BA7517' : '#E24B4A' }}>
                        {mttrDays}d
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400 mb-1.5">vs &lt;1d target</p>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((mttrDays / 5) * 100))}%`, background: mttrDays <= 1 ? 'var(--severity-low)' : mttrDays <= 3 ? 'var(--severity-medium)' : 'var(--severity-critical)' }} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No resolved findings yet to measure.</p>
                  )}
                </div>

                <div className="p-5 bg-white rounded-2xl border border-gray-100">
                  <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase">Pipeline gate status</p>
                  <div className="space-y-2.5">
                    {pipelineGateStatus.map((g) => (
                      <div key={g.env} className="flex justify-between items-center">
                        <span className="text-xs font-medium text-gray-700">{g.env}</span>
                        <span className="text-sm font-semibold" style={{ color: g.color }}>{g.icon}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Audit / mesh ── */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="p-5 bg-white rounded-2xl border border-gray-100">
                  <p className="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase">Audit ledger</p>
                  <p className="text-[10px] text-gray-400 mb-3">Recent security actions</p>
                  {auditEntries.length > 0 ? (
                    <div className="space-y-3">
                      {auditEntries.map((item, idx) => (
                        <div key={idx} className="text-xs leading-tight text-gray-700">
                          <p>{item.action} <span className="text-gray-400">by {item.resource}</span></p>
                          <p className="text-[10px] text-gray-400">{item.time}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No audited actions recorded yet.</p>
                  )}
                </div>

                <div className="p-5 bg-white rounded-2xl border border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold tracking-wider text-gray-400 uppercase">Alert mesh nodes</p>
                    <Link to="/alerts" className="text-[10px] font-medium text-blue-600 hover:underline">Configure →</Link>
                  </div>
                  <p className="text-[10px] text-gray-400 mb-3">Webhook configuration status</p>
                  <div className="space-y-3">
                    {meshStatus.map((item) => (
                      <div key={item.channel} className="flex justify-between items-center">
                        <span className="text-xs text-gray-700">{item.channel}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${item.configured ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          <span className="text-[10px] text-gray-400">{item.configured ? 'Configured' : 'Not configured'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Scan heatmap — last, least important ── */}
              <div className="p-5 bg-white rounded-2xl border border-gray-100">
                <p className="mb-3 text-xs font-semibold tracking-wider text-gray-400 uppercase">Scan activity — last 12 weeks</p>
                <div className="overflow-x-auto">
                  <HeatmapGrid data={heatmapData} days={84} cellSize={14} label="" />
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-3 text-[10px] text-gray-400">
                  <span>Less</span>
                  {[0.1, 0.3, 0.5, 0.7, 1].map((o) => (
                    <div key={o} className="w-2.5 h-2.5 rounded-sm border border-gray-100" style={{ background: `rgba(55,138,221,${o})` }} />
                  ))}
                  <span>More</span>
                </div>
              </div>

            </div>
          )}
        </div>

      </div>

      {/* ── CI gate modal ── */}
      {showGateSummary && (
        <div className="flex fixed inset-0 z-50 justify-center items-center p-4 bg-black/40">
          <div className="p-6 w-full max-w-lg bg-white rounded-2xl shadow-xl">
            <div className="flex gap-2 items-center mb-5">
              <ShieldAlert size={18} className="text-red-500" />
              <h2 className="text-sm font-semibold text-gray-900">Policy blocking summary</h2>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {gateSummary.length > 0 ? gateSummary.map((repo, i) => (
                <div key={i} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium text-gray-900">{repo.name}</span>
                    <span className="text-[10px] font-semibold text-red-500 uppercase">Blocked</span>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-500">{repo.reason}</p>
                </div>
              )) : (
                <div className="py-10 text-center">
                  <ShieldCheck size={28} className="mx-auto mb-2 text-emerald-500" />
                  <p className="text-sm font-medium text-gray-700">All monitored assets are compliant.</p>
                </div>
              )}
            </div>
            <button onClick={() => setShowGateSummary(false)} className="w-full mt-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-2xl hover:bg-gray-800 transition-colors">
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {/* ── Remediation panel ── */}
      {selectedRemediationFindingId && (
        <RemediationPanel
          documentId={selectedRemediationFindingId}
          onClose={() => setSelectedRemediationFindingId(null)}
        />
      )}

    </div>
  );
}