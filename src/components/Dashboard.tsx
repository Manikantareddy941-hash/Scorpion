import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  XCircle,
  ShieldCheck,
  Zap,
  RefreshCw,
  ArrowRight,
  Lock,
  Package,
  Code2,
  Cloud,
} from 'lucide-react';
import RemediationPanel from './RemediationPanel';
import NewScanModal from './NewScanModal';
import toast from 'react-hot-toast';
import PostureDonut from './charts/PostureDonut';
import CoverageRadar from './charts/CoverageRadar';
import VulnTrend from './charts/VulnTrend';
import GateRulesDrawer, { evaluatePreflight, type Reachability } from './GateRulesDrawer';
import { useGateRules } from '../hooks/useGateRules';
import { VibrationTrace, severityVar, type HeatmapDatum, type Severity } from './ui';
import { SLA_HOURS } from '../lib/sla';
import PostureExportButton from './PostureExportButton';
import DriftAlertsTable from './DriftAlertsTable';

export default function Dashboard({
  isSidebarCollapsed: _isSidebarCollapsed,
}: {
  isSidebarCollapsed: boolean;
}) {
  const { getJWT, user } = useAuth();

  const [loading, setLoading] = useState(true);
  // Workbench deep-link: ?findingId=<id> drives the side drawer. Refresh / direct URL auto-opens, shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRemediationFindingId = searchParams.get('findingId');
  const setSelectedRemediationFindingId = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('findingId', id);
        else next.delete('findingId');
        return next;
      },
      { replace: false },
    );
  };
  const [remediationQueue, setRemediationQueue] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ciGateStats, setCiGateStats] = useState({ passed: 0, blocked: 0, rate: 0 });
  const [policyPassRate, setPolicyPassRate] = useState(100);
  const [activeScansCount, setActiveScansCount] = useState<number>(0);

  const [vulnStats, setVulnStats] = useState({
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    bugs: 0,
    codeSmells: 0,
    total: 0,
    score: 100,
    linesScanned: 0,
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

  const [qualityGateScore, setQualityGateScore] = useState<number>(0);
  const [lastBuildStatus, setLastBuildStatus] = useState<string>('N/A');
  const [deploymentsToday, setDeploymentsToday] = useState<number>(0);
  const [byType, setByType] = useState({ secret: 0, dependency: 0, sast: 0, iac: 0 });
  const [heatmapData, setHeatmapData] = useState<HeatmapDatum[]>([]);
  const [repoRisk, setRepoRisk] = useState<
    { repo_id: string; repo_name: string; critical: number; high: number }[]
  >([]);
  const [mttrDays, setMttrDays] = useState<number | null>(null);
  const [remediationStats, setRemediationStats] = useState({
    queueCount: 0,
    prsCreatedToday: 0,
    avgDetectionToPrDays: null as number | null,
  });
  const [auditEntries, setAuditEntries] = useState<
    { action: string; resource: string; time: string }[]
  >([]);
  const [meshStatus, setMeshStatus] = useState<{ channel: string; configured: boolean }[]>([]);
  const [recentDeployments, setRecentDeployments] = useState<
    { environment: string; status: string }[]
  >([]);
  const [slaStats, setSlaStats] = useState({
    breached: 0,
    dueSoon: 0,
    breachedCritical: 0,
    nextHours: null as number | null,
  });
  const [showGateRules, setShowGateRules] = useState(false);
  const [showNewScanModal, setShowNewScanModal] = useState(false);
  const {
    rules: gateRules,
    env: gateEnv,
    setRules: setGateRules,
    setEnv: setGateEnv,
  } = useGateRules();

  const ENV_STATUS_STYLE: Record<string, { icon: string; color: string }> = {
    success: { icon: '✓', color: 'var(--status-success)' },
    failed: { icon: '✗', color: 'var(--status-error)' },
    running: { icon: '…', color: 'var(--status-warning)' },
    'rolled-back': { icon: '↺', color: 'var(--text-muted)' },
  };

  const pipelineGateStatus = ['dev', 'staging', 'production'].map((env) => {
    const latest = recentDeployments.find((d) => d.environment === env);
    const style = latest
      ? (ENV_STATUS_STYLE[latest.status] ?? { icon: '•', color: 'var(--text-muted)' })
      : { icon: '—', color: 'var(--text-muted)' };
    return {
      env: env.toUpperCase(),
      icon: style.icon,
      color: style.color,
      status: latest?.status ?? 'No deploys yet',
    };
  });

  const gateColor = (ratio: number) =>
    ratio >= 0.8
      ? 'var(--status-success)'
      : ratio >= 0.5
        ? 'var(--status-warning)'
        : 'var(--status-error)';

  // ── All data-fetching logic preserved exactly ──────────────────────────────

  const fetchDashboardData = useCallback(
    async (isAuto = false) => {
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

        // These six loads share no data dependency on each other (only the repo/scan
        // fetches below need repoIds), so they run concurrently instead of one big
        // sequential await chain. Each keeps its own try/catch so one failing fetch
        // can't block or blank out the others.
        const fetchGateSummary = async () => {
          let gateSummaryData: any[] = [];
          try {
            const gateRes = await fetch('/api/gates/summary', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (gateRes.ok) {
              const gateData = await gateRes.json();
              gateSummaryData = gateData.failedRepos || [];
            }
          } catch (err) {
            console.warn('Failed to fetch gate summary:', err);
          }
          setGateSummary(gateSummaryData);
        };

        const fetchSecurityBreakdown = async () => {
          try {
            const secRes = await fetch('/api/dashboard/security', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (secRes.ok) {
              const secData = await secRes.json();
              const t = secData?.by_type || {};
              setByType({
                secret: Number(t.secret ?? 0),
                dependency: Number(t.dependency ?? 0),
                sast: Number(t.sast ?? 0),
                iac: Number(t.iac ?? 0),
              });
              setMttrDays(secData?.mttr_days ?? null);
              const repos = (secData?.by_repo || []) as {
                repo_id: string;
                repo_name: string;
                count: number;
                critical: number;
                high: number;
              }[];
              setRepoRisk(
                [...repos]
                  .sort((a, b) => b.critical * 10 + b.high - (a.critical * 10 + a.high))
                  .slice(0, 5),
              );
            }
          } catch (err) {
            console.warn('Failed to fetch security breakdown:', err);
          }
        };

        const fetchRemediationStats = async () => {
          try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const [queueRes, remediatedTodayRes] = await Promise.all([
              databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.equal('status', 'open'),
                Query.limit(1),
              ]),
              databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
                Query.equal('resolution_status', 'remediated'),
                Query.greaterThanEqual('$updatedAt', startOfDay.toISOString()),
                Query.limit(50),
              ]),
            ]);
            const detectionToPrDurationsMs = remediatedTodayRes.documents
              .map((d: any) => new Date(d.$updatedAt).getTime() - new Date(d.$createdAt).getTime())
              .filter((ms: number) => ms > 0);
            const avgDetectionToPrDays =
              detectionToPrDurationsMs.length > 0
                ? Math.round(
                    (detectionToPrDurationsMs.reduce((sum, ms) => sum + ms, 0) /
                      detectionToPrDurationsMs.length /
                      (1000 * 60 * 60 * 24)) *
                      10,
                  ) / 10
                : null;
            setRemediationStats({
              queueCount: queueRes.total,
              prsCreatedToday: remediatedTodayRes.total,
              avgDetectionToPrDays,
            });
          } catch (err) {
            console.warn('Failed to fetch remediation queue stats:', err);
          }
        };

        // SLA breach/countdown — derived from each open finding's age vs its severity window.
        const fetchSlaStats = async () => {
          try {
            const openVulns = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
              Query.equal('status', 'open'),
              Query.orderDesc('$createdAt'),
              Query.limit(200),
            ]);
            const now = Date.now();
            let breached = 0,
              dueSoon = 0,
              breachedCritical = 0;
            let nextHours: number | null = null;
            openVulns.documents.forEach((d: any) => {
              const sev = String(d.severity || '').toLowerCase();
              const slaH = SLA_HOURS[sev] ?? 168;
              const hoursLeft = (new Date(d.$createdAt).getTime() + slaH * 3600_000 - now) / 3600_000;
              if (hoursLeft <= 0) {
                breached++;
                if (sev === 'critical') breachedCritical++;
              } else {
                if (hoursLeft <= 24) dueSoon++;
                nextHours = nextHours === null ? hoursLeft : Math.min(nextHours, hoursLeft);
              }
            });
            setSlaStats({ breached, dueSoon, breachedCritical, nextHours });
          } catch (err) {
            console.warn('Failed to compute SLA stats:', err);
          }
        };

        const fetchAuditEntries = async () => {
          try {
            const auditRes = await fetch('/api/audit', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (auditRes.ok) {
              const auditDocs = await auditRes.json();
              setAuditEntries(
                auditDocs.slice(0, 3).map((d: any) => ({
                  action: `${d.action || 'action'} · ${d.resource || d.resourceId || 'system'}`,
                  resource: d.actorEmail || d.actor || 'system',
                  time: new Date(d.timestamp || d.$createdAt).toLocaleString([], {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                })),
              );
            }
          } catch (err) {
            console.warn('Failed to fetch audit log:', err);
          }
        };

        const fetchIntegrationStatus = async () => {
          try {
            if (user) {
              const integrationsRes = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
                Query.equal('userId', user.$id),
                Query.limit(1),
              ]);
              const integration = integrationsRes.documents[0];
              setMeshStatus([
                { channel: 'Slack', configured: !!integration?.slack_webhook },
                { channel: 'Discord', configured: !!integration?.discord_webhook },
                { channel: 'PagerDuty', configured: !!integration?.pagerduty_key },
              ]);
            }
          } catch (err) {
            console.warn('Failed to fetch integration status:', err);
          }
        };

        await Promise.allSettled([
          fetchGateSummary(),
          fetchSecurityBreakdown(),
          fetchRemediationStats(),
          fetchSlaStats(),
          fetchAuditEntries(),
          fetchIntegrationStatus(),
        ]);

        let reposDocuments: any[] = [];
        try {
          const reposRes = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.orderDesc('$createdAt'),
            Query.limit(20),
          ]);
          reposDocuments = reposRes.documents;
        } catch (err) {
          console.warn('Failed to fetch repositories from Appwrite:', err);
        }

        if (
          reposDocuments.length === 0 &&
          localStorage.getItem('scorpion_demo_seeded') === 'true'
        ) {
          const { MOCK_REPOSITORIES } = await import('../lib/demoData');
          reposDocuments = MOCK_REPOSITORIES as any;
        }

        const repoIds = reposDocuments.map((r) => r.$id);
        const repoUrls = reposDocuments.map((r) => r.url).filter(Boolean);

        if (repoIds.length === 0) {
          setLoading(false);
          return;
        }

        let scansDocuments: any[] = [];
        try {
          const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.or([Query.equal('repo_id', repoIds), Query.equal('repoUrl', repoUrls)]),
            Query.equal('status', 'completed'),
            Query.orderDesc('$createdAt'),
            Query.limit(1),
          ]);
          scansDocuments = scansRes.documents;
        } catch (err) {
          console.warn('Failed to fetch scans from Appwrite:', err);
        }

        if (
          scansDocuments.length === 0 &&
          localStorage.getItem('scorpion_demo_seeded') === 'true'
        ) {
          const { MOCK_SCANS } = await import('../lib/demoData');
          scansDocuments = [MOCK_SCANS[1]] as any;
        }

        const latestCompletedScan = scansDocuments[0] || null;

        let activityDocuments: any[] = [];
        try {
          const activityRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.or([Query.equal('repo_id', repoIds), Query.equal('repoUrl', repoUrls)]),
            Query.orderDesc('$createdAt'),
            Query.limit(90),
          ]);
          activityDocuments = activityRes.documents;
        } catch (err) {
          console.warn('Failed to fetch activity scans from Appwrite:', err);
        }

        if (
          activityDocuments.length === 0 &&
          localStorage.getItem('scorpion_demo_seeded') === 'true'
        ) {
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

        let passed = 0;
        let blocked = 0;
        let active = 0;
        scans.forEach((s) => {
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
        });

        setCiGateStats({
          passed,
          blocked,
          rate: passed + blocked > 0 ? Math.round((passed / (passed + blocked)) * 100) : 0,
        });
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
          let total =
            scan.total ??
            scan.totalIssues ??
            scan.vulnerabilities ??
            (scan.critical ?? scan.criticalCount ?? 0) +
              (scan.high ?? scan.highCount ?? 0) +
              (scan.medium ?? scan.mediumCount ?? 0) +
              (scan.low ?? scan.lowCount ?? 0);
          // Fallback formula matches backend/src/services/scanService.ts's computeSecurityScore exactly,
          // so a scan with no persisted score still scores the same on the frontend as the backend would.
          const fallbackScore = (c: number, h: number, m: number, l: number) =>
            Math.max(0, Math.round(100 - c * 10 - h * 4 - m * 1 - l * 0.25));
          let score =
            scan.score ??
            scan.securityScore ??
            scan.security_score ??
            scan.security_rating ??
            fallbackScore(crit, high, med, low);

          if (latestCompletedScan.details && typeof latestCompletedScan.details === 'string') {
            try {
              const d = JSON.parse(latestCompletedScan.details);
              if (d.critical_count !== undefined) crit = Math.max(crit, Number(d.critical_count));
              if (d.high_count !== undefined) high = Math.max(high, Number(d.high_count));
              if (d.medium_count !== undefined) med = Math.max(med, Number(d.medium_count));
              if (d.low_count !== undefined) low = Math.max(low, Number(d.low_count));
              if (d.total_vulnerabilities !== undefined)
                total = Math.max(total, Number(d.total_vulnerabilities));
              if (d.security_score !== undefined)
                score =
                  Number(d.security_score) === 0
                    ? fallbackScore(crit, high, med, low)
                    : Number(d.security_score);
              if (d.bugs !== undefined) bugs = Math.max(bugs, Number(d.bugs));
              if (d.total_lines !== undefined) lines = Number(d.total_lines);
            } catch (e) {}
          }

          if (total === 0) total = crit + high + med + low;
          const finalScore =
            score !== undefined && score !== null
              ? Math.round(Number(score))
              : fallbackScore(crit, high, med, low);
          setVulnStats({
            critical: crit,
            high,
            medium: med,
            low,
            bugs,
            total,
            score: finalScore,
            linesScanned: lines,
            codeSmells: 0,
          });
          setPolicyPassRate(
            finalScore > 85 ? 100 : finalScore > 65 ? 80 : finalScore > 40 ? 60 : 30,
          );
          setQualityGateScore(
            localStorage.getItem('scorpion_demo_seeded') === 'true'
              ? 68
              : Math.max(0, finalScore - 5),
          );
        } else {
          setVulnStats({
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            bugs: 0,
            total: 0,
            score: 0,
            linesScanned: 0,
            codeSmells: 0,
          });
          setPolicyPassRate(0);
          setQualityGateScore(0);
        }

        let vulnsDocuments: any[] = [];
        try {
          const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.orderDesc('$createdAt'),
            Query.limit(5),
          ]);
          vulnsDocuments = vulnsRes.documents;
        } catch (err) {
          console.warn('Failed to fetch vulnerabilities from Appwrite:', err);
        }

        if (
          vulnsDocuments.length === 0 &&
          localStorage.getItem('scorpion_demo_seeded') === 'true'
        ) {
          const { MOCK_FINDINGS } = await import('../lib/demoData');
          vulnsDocuments = MOCK_FINDINGS as any;
        }

        setLatestVulnerabilities(vulnsDocuments.slice(0, 5));
        setRemediationQueue(vulnsDocuments.slice(0, 5));

        try {
          const buildRes = await databases.listDocuments(DB_ID, COLLECTIONS.BUILD_PIPELINES, [
            Query.orderDesc('$createdAt'),
            Query.limit(1),
          ]);
          setLastBuildStatus(buildRes.documents.length > 0 ? buildRes.documents[0].status : 'N/A');
        } catch (err) {
          console.warn('Failed to fetch builds:', err);
        }

        try {
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          const deployRes = await databases.listDocuments(DB_ID, COLLECTIONS.DEPLOYMENTS, [
            Query.greaterThanEqual('$createdAt', startOfDay.toISOString()),
            Query.limit(100),
          ]);
          setDeploymentsToday(deployRes.documents.length || 0);
        } catch (err) {
          console.warn('Failed to fetch deployments:', err);
        }

        try {
          const envDeployRes = await databases.listDocuments(DB_ID, COLLECTIONS.DEPLOYMENTS, [
            Query.orderDesc('$createdAt'),
            Query.limit(30),
          ]);
          setRecentDeployments(
            envDeployRes.documents.map((d: any) => ({
              environment: d.environment,
              status: d.status,
            })),
          );
        } catch (err) {
          console.warn('Failed to fetch deployment environment status:', err);
        }

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
    },
    [getJWT, user],
  );

  useEffect(() => {
    fetchDashboardData();
    const handleManualRefresh = () => fetchDashboardData(true);
    window.addEventListener('refresh-dashboard', handleManualRefresh);
    let realtimeDebounce: NodeJS.Timeout;
    const unsubscribe = client.subscribe(
      [`databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents`],
      (response) => {
        if (response.events.some((e) => e.includes('.create') || e.includes('.update'))) {
          const payload = response.payload as any;
          if (payload?.status === 'completed') {
            clearTimeout(realtimeDebounce);
            realtimeDebounce = setTimeout(() => fetchDashboardData(true), 10000);
          }
        }
      },
    );
    return () => {
      if (unsubscribe) unsubscribe();
      window.removeEventListener('refresh-dashboard', handleManualRefresh);
      clearTimeout(realtimeDebounce);
    };
  }, [fetchDashboardData]);

  // ── Derived values ──────────────────────────────────────────────────────────

  // Security debt — estimated remediation hours, weighted by severity. Translates
  // raw finding counts into engineering-time the way a PM/lead reads it.
  const securityDebtHours = Math.round(
    vulnStats.critical * 8 + vulnStats.high * 4 + vulnStats.medium * 2 + vulnStats.low * 0.5,
  );

  // Reachability gate: reduce the scan route's vulnerable packages to one verdict.
  // Worst-case wins — any reachable > any unknown > unreachable; no reachability
  // data at all → undefined, so evaluatePreflight falls back to count-based rules.
  const scanVulns: { severity?: string; reachability?: Reachability }[] = (() => {
    if (latestScan?.details && typeof latestScan.details === 'string') {
      try {
        const d = JSON.parse(latestScan.details);
        if (Array.isArray(d.vulnerabilities)) return d.vulnerabilities;
      } catch {
        /* ignore malformed details */
      }
    }
    return latestVulnerabilities;
  })();

  const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const reachableVulns = scanVulns.filter((v) => v.reachability === 'reachable');
  const reachabilityVerdict: Reachability | undefined =
    reachableVulns.length > 0
      ? 'reachable'
      : scanVulns.some((v) => v.reachability === 'unknown')
        ? 'unknown'
        : scanVulns.some((v) => v.reachability)
          ? 'unreachable'
          : undefined;
  const worstReachableSev = reachableVulns
    .map((v) => String(v.severity || '').toLowerCase())
    .sort((a, b) => (SEV_RANK[b] ?? 0) - (SEV_RANK[a] ?? 0))[0];

  // Pre-flight: reachability-driven, env-aware; counts/rules as fallback.
  const preflightCounts = {
    critical: vulnStats.critical,
    high: vulnStats.high,
    medium: vulnStats.medium,
    low: vulnStats.low,
  };
  const preflight = evaluatePreflight(gateRules, preflightCounts, gateEnv, reachabilityVerdict);
  const preflightColor =
    preflight.tone === 'error'
      ? 'var(--status-error)'
      : preflight.tone === 'warning'
        ? 'var(--status-warning)'
        : 'var(--status-success)';
  const capWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const preflightReason =
    reachabilityVerdict === 'reachable'
      ? `${capWord(worstReachableSev || 'vuln')} reachable in ${gateEnv}`
      : reachabilityVerdict === 'unknown'
        ? `Reachability unknown in ${gateEnv}`
        : reachabilityVerdict === 'unreachable'
          ? `No reachable vulns in ${gateEnv}`
          : preflight.reason;
  // Exact badge, e.g. "BLOCKED: Critical reachable in prod".
  const preflightBadge = `${preflight.label.toUpperCase()}: ${preflightReason}`;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const scansLast7 = heatmapData
    .filter((d) => new Date(d.date) >= sevenDaysAgo)
    .reduce((s, d) => s + d.count, 0);
  const maxRepoFindings = Math.max(1, ...repoRisk.map((r) => r.critical + r.high));

  const gateRows = [
    {
      id: 'ci',
      label: 'CI Gate',
      value: `${ciGateStats.rate}%`,
      sub: `${ciGateStats.passed} passed · ${ciGateStats.blocked} blocked`,
      color: gateColor(ciGateStats.rate / 100),
    },
    {
      id: 'quality',
      label: 'Quality Gate',
      value: `${qualityGateScore || 0}/100`,
      sub: qualityGateScore > 70 ? 'Passed' : qualityGateScore > 50 ? 'Warning' : 'Failed',
      color: gateColor(qualityGateScore / 100),
    },
    {
      id: 'policy',
      label: 'Policy Pass',
      value: `${policyPassRate}%`,
      sub: 'Compliance',
      color: gateColor(policyPassRate / 100),
    },
    {
      id: 'build',
      label: 'Last Build',
      value: lastBuildStatus.toUpperCase(),
      sub: 'Status',
      color:
        lastBuildStatus === 'success'
          ? 'var(--status-success)'
          : lastBuildStatus === 'failed'
            ? 'var(--status-error)'
            : 'var(--status-warning)',
    },
    {
      id: 'deploy',
      label: 'Deployments',
      value: deploymentsToday.toString(),
      sub: 'Today',
      color: 'var(--accent-primary)',
    },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setVulnStats({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      bugs: 0,
      total: 0,
      score: 0,
      linesScanned: 0,
      codeSmells: 0,
    });
    setPolicyPassRate(0);
    setLastBuildStatus('N/A');
    setDeploymentsToday(0);
    isFetchingRef.current = true;
    await fetchDashboardData();
  };

  // ── Skeleton ────────────────────────────────────────────────────────────────

  const SkeletonCard = ({ className = '' }: { className?: string }) => (
    <div
      className={`p-4 bg-[var(--bg-card)] rounded-md border border-[var(--border-subtle)] animate-pulse ${className}`}
    >
      <div className="mb-3 w-1/2 h-3 bg-[var(--bg-secondary)] rounded" />
      <div className="w-1/3 h-7 bg-[var(--bg-secondary)] rounded" />
    </div>
  );

  // ── Error state ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px] bg-[var(--bg-secondary)]">
        <div className="text-center">
          <XCircle size={40} className="mx-auto mb-3 text-[var(--status-error)]" />
          <h2 className="mb-1 text-base font-medium text-[var(--text-primary)]">
            Failed to load dashboard
          </h2>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm font-medium rounded-2xl transition-colors hover:opacity-90"
            style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const CARD =
    'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[0_1px_2px_rgba(28,25,23,0.04),0_4px_16px_rgba(28,25,23,0.04)]';

  const sevLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  const severityCounts = [
    { key: 'critical' as Severity, count: vulnStats.critical },
    { key: 'high' as Severity, count: vulnStats.high },
    { key: 'medium' as Severity, count: vulnStats.medium },
    { key: 'low' as Severity, count: vulnStats.low },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-[1400px] space-y-8 px-6 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Security dashboard</h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Posture, findings, and pipeline health across every stage
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium md:inline-flex"
              style={{
                color: 'var(--status-success)',
                background: 'color-mix(in srgb, var(--status-success) 10%, transparent)',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--status-success)' }}
              />
              Live
            </span>
            <PostureExportButton
              getSnapshot={() => ({
                generatedAt: new Date(),
                actor: user?.email || 'unknown',
                preflight: {
                  label: preflight.label,
                  reason: preflightBadge,
                  status: preflight.status,
                },
                riskScore: vulnStats.score,
                securityDebtHours,
                vulnStats: {
                  critical: vulnStats.critical,
                  high: vulnStats.high,
                  medium: vulnStats.medium,
                  low: vulnStats.low,
                  bugs: vulnStats.bugs,
                  total: vulnStats.total,
                },
                slaStats: {
                  breached: slaStats.breached,
                  dueSoon: slaStats.dueSoon,
                  breachedCritical: slaStats.breachedCritical,
                },
                gateRows: gateRows.map((row) => ({
                  label: row.label,
                  value: String(row.value),
                  sub: row.sub,
                })),
              })}
            />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Refresh dashboard"
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => setShowNewScanModal(true)}
              className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
            >
              <Zap size={14} />
              New scan
            </button>
          </div>
        </div>

        {loading && !latestScan ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <>
            {/* Release gate verdict */}
            <section
              aria-label="Release gate"
              className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-5 py-4`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: `color-mix(in srgb, ${preflightColor} 12%, transparent)`,
                  }}
                  aria-hidden
                >
                  <ShieldCheck size={16} style={{ color: preflightColor }} />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: preflightColor }}>
                    Release gate · {sevLabel(preflight.label)}
                  </p>
                  <p className="truncate text-[12px] text-[var(--text-secondary)]">
                    {preflightReason}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[var(--bg-secondary)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                  {gateEnv}
                </span>
                {gateSummary.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowGateSummary(true)}
                    className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-[var(--status-error)] transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    {gateSummary.length} failing {gateSummary.length === 1 ? 'repo' : 'repos'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowGateRules(true)}
                  className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  Gate rules
                </button>
              </div>
            </section>

            {/* KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className={`${CARD} p-5`}>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Risk score</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                  {vulnStats.score}
                  <span className="text-[15px] font-medium text-[var(--text-muted)]"> /100</span>
                </p>
                <div className="mt-2">
                  <VibrationTrace
                    activity={Math.min(1, vulnStats.total / 60)}
                    critical={vulnStats.critical > 0}
                    height={28}
                  />
                </div>
              </div>

              <div className={`${CARD} p-5`}>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Open findings</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                  {vulnStats.total}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {severityCounts.map((s) => (
                    <Link
                      key={s.key}
                      to={latestScanId ? `/scans/${latestScanId}/sast?filter=${s.key}` : '/issues'}
                      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: severityVar(s.key) }}
                        aria-hidden
                      />
                      {sevLabel(s.key)}
                      <span className="font-semibold tabular-nums">{s.count}</span>
                    </Link>
                  ))}
                </div>
              </div>

              <div className={`${CARD} p-5`}>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">SLA health</p>
                <p
                  className="mt-2 text-3xl font-semibold tracking-tight tabular-nums"
                  style={{ color: slaStats.breached > 0 ? 'var(--status-error)' : 'var(--text-primary)' }}
                >
                  {slaStats.breached}
                  <span className="text-[15px] font-medium text-[var(--text-muted)]"> breached</span>
                </p>
                <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                  {slaStats.dueSoon} due within 24h
                  {slaStats.nextHours !== null && ` · next in ${Math.max(0, Math.round(slaStats.nextHours))}h`}
                </p>
              </div>

              <div className={`${CARD} p-5`}>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Security debt</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                  {securityDebtHours}
                  <span className="text-[15px] font-medium text-[var(--text-muted)]"> hours</span>
                </p>
                <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                  {mttrDays !== null ? `MTTR ${mttrDays} days` : 'MTTR not yet measured'}
                  {` · ${remediationStats.queueCount} in queue`}
                </p>
              </div>
            </div>

            {/* Findings + gates */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <section aria-label="Latest findings" className={`${CARD} xl:col-span-2`}>
                <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
                  <h2 className="text-base font-semibold tracking-tight">Latest findings</h2>
                  <Link
                    to="/issues"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--accent-primary)] hover:opacity-80"
                  >
                    View all
                    <ArrowRight size={14} />
                  </Link>
                </header>
                {remediationQueue.length > 0 ? (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {remediationQueue.map((f: any) => {
                      const sev = String(f.severity || 'info').toLowerCase();
                      return (
                        <li key={f.$id}>
                          <button
                            type="button"
                            onClick={() => setSelectedRemediationFindingId(f.$id)}
                            className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
                          >
                            <span
                              className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                              style={{
                                color: severityVar(sev as Severity),
                                background: `color-mix(in srgb, ${severityVar(sev as Severity)} 10%, transparent)`,
                              }}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: severityVar(sev as Severity) }}
                                aria-hidden
                              />
                              {sevLabel(sev)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">
                                {f.title || f.message || 'Untitled finding'}
                              </span>
                              <span className="mt-0.5 block text-[12px] text-[var(--text-muted)]">
                                {[
                                  f.repo_name,
                                  f.file_path,
                                  f.$createdAt &&
                                    new Date(f.$createdAt).toLocaleString([], {
                                      dateStyle: 'short',
                                      timeStyle: 'short',
                                    }),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                            <ArrowRight
                              size={14}
                              className="mt-1 shrink-0 text-[var(--text-muted)]"
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="px-5 py-10 text-center text-[13px] text-[var(--text-secondary)]">
                    No open findings. Run a scan to check the latest code.
                  </div>
                )}
              </section>

              <div className="space-y-4">
                <section aria-label="Pipeline gates" className={CARD}>
                  <header className="border-b border-[var(--border-subtle)] px-5 py-4">
                    <h2 className="text-base font-semibold tracking-tight">Pipeline gates</h2>
                  </header>
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {gateRows.map((row) => (
                      <li key={row.id} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="text-[13px] font-medium">{row.label}</p>
                          <p className="text-[11px] text-[var(--text-muted)]">{row.sub}</p>
                        </div>
                        <span
                          className="text-[13px] font-semibold tabular-nums"
                          style={{ color: row.color }}
                        >
                          {row.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-label="Environments" className={CARD}>
                  <header className="border-b border-[var(--border-subtle)] px-5 py-4">
                    <h2 className="text-base font-semibold tracking-tight">Environments</h2>
                  </header>
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {pipelineGateStatus.map((env) => (
                      <li key={env.env} className="flex items-center justify-between px-5 py-3">
                        <span className="text-[13px] font-medium">{sevLabel(env.env)}</span>
                        <span className="text-[12px] capitalize" style={{ color: env.color }}>
                          {env.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <section aria-label="Posture by severity" className={`${CARD} flex flex-col p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Posture by severity</h2>
                <div className="mt-3 min-h-[260px] flex-1">
                  <PostureDonut
                    critical={vulnStats.critical}
                    high={vulnStats.high}
                    medium={vulnStats.medium}
                    low={vulnStats.low}
                  />
                </div>
              </section>
              <section aria-label="Scan coverage" className={`${CARD} flex flex-col p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Scan coverage</h2>
                <div className="mt-3 min-h-[260px] flex-1">
                  <CoverageRadar />
                </div>
              </section>
              <section aria-label="Vulnerability trend" className={`${CARD} flex flex-col p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Vulnerability trend</h2>
                <div className="mt-3 min-h-[260px] flex-1">
                  <VulnTrend total={vulnStats.total} />
                </div>
              </section>
            </div>

            {/* Sources + repos at risk */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <section aria-label="Findings by source" className={`${CARD} p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Findings by source</h2>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Secrets', count: byType.secret, icon: Lock },
                    { label: 'Dependencies', count: byType.dependency, icon: Package },
                    { label: 'Static analysis', count: byType.sast, icon: Code2 },
                    { label: 'Infrastructure', count: byType.iac, icon: Cloud },
                  ].map((b) => (
                    <div
                      key={b.label}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3"
                    >
                      <b.icon size={14} className="text-[var(--text-muted)]" aria-hidden />
                      <p className="mt-2 text-xl font-semibold tabular-nums">{b.count}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{b.label}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Repositories at risk" className={CARD}>
                <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
                  <h2 className="text-base font-semibold tracking-tight">Repositories at risk</h2>
                  <Link
                    to="/repos"
                    className="text-[13px] font-medium text-[var(--accent-primary)] hover:opacity-80"
                  >
                    All repos
                  </Link>
                </header>
                {repoRisk.length > 0 ? (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {repoRisk.map((r) => {
                      const load = r.critical + r.high;
                      return (
                        <li key={r.repo_id} className="px-5 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[13px] font-medium">{r.repo_name}</p>
                            <p className="shrink-0 text-[12px] text-[var(--text-muted)] tabular-nums">
                              {r.critical} critical · {r.high} high
                            </p>
                          </div>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(6, (load / maxRepoFindings) * 100)}%`,
                                background:
                                  r.critical > 0
                                    ? 'var(--severity-critical)'
                                    : 'var(--severity-high)',
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="px-5 py-10 text-center text-[13px] text-[var(--text-secondary)]">
                    No repository risk data yet.
                  </div>
                )}
              </section>
            </div>

            {/* Runtime drift */}
            <DriftAlertsTable />

            {/* Operations */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <section aria-label="Remediation" className={`${CARD} p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Remediation</h2>
                <ul className="mt-3 space-y-2 text-[13px] text-[var(--text-secondary)]">
                  <li className="flex justify-between">
                    <span>Open in queue</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {remediationStats.queueCount}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Fixed today</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {remediationStats.prsCreatedToday}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Avg. detection to fix</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {remediationStats.avgDetectionToPrDays !== null
                        ? `${remediationStats.avgDetectionToPrDays} days`
                        : '—'}
                    </span>
                  </li>
                </ul>
              </section>

              <section aria-label="Scan activity" className={`${CARD} p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Scan activity</h2>
                <ul className="mt-3 space-y-2 text-[13px] text-[var(--text-secondary)]">
                  <li className="flex justify-between">
                    <span>Scans · last 7 days</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {scansLast7}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Running now</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {activeScansCount}
                    </span>
                  </li>
                  {auditEntries.slice(0, 2).map((a, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="truncate">{a.action}</span>
                      <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{a.time}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="Alert channels" className={`${CARD} p-5`}>
                <h2 className="text-base font-semibold tracking-tight">Alert channels</h2>
                <ul className="mt-3 space-y-2">
                  {(meshStatus.length > 0
                    ? meshStatus
                    : [
                        { channel: 'Slack', configured: false },
                        { channel: 'Discord', configured: false },
                        { channel: 'PagerDuty', configured: false },
                      ]
                  ).map((m) => (
                    <li key={m.channel} className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--text-secondary)]">{m.channel}</span>
                      <span
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                        style={{
                          color: m.configured ? 'var(--status-success)' : 'var(--text-muted)',
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: m.configured
                              ? 'var(--status-success)'
                              : 'var(--text-muted)',
                          }}
                          aria-hidden
                        />
                        {m.configured ? 'Connected' : 'Not set up'}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/alerts"
                  className="mt-3 inline-block text-[13px] font-medium text-[var(--accent-primary)] hover:opacity-80"
                >
                  Manage channels
                </Link>
              </section>
            </div>
          </>
        )}
      </div>

      {/* Failing repos modal */}
      {showGateSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${CARD} w-full max-w-lg p-6`}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold tracking-tight">Repositories failing the gate</h3>
              <button
                type="button"
                onClick={() => setShowGateSummary(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              >
                <XCircle size={18} />
              </button>
            </div>
            <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {gateSummary.map((repo: any, i: number) => (
                <li
                  key={repo.repo_id || i}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
                >
                  <span className="truncate text-[13px] font-medium">
                    {repo.repo_name || repo.name || 'Repository'}
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--status-error)]">
                    {repo.reason || 'Gate failed'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Remediation drawer */}
      {selectedRemediationFindingId && (
        <RemediationPanel
          documentId={selectedRemediationFindingId}
          onClose={() => setSelectedRemediationFindingId(null)}
        />
      )}

      {showGateRules && (
        <GateRulesDrawer
          onClose={() => setShowGateRules(false)}
          rules={gateRules}
          env={gateEnv}
          onChange={setGateRules}
          onEnvChange={setGateEnv}
          counts={preflightCounts}
        />
      )}

      {showNewScanModal && (
        <NewScanModal
          onClose={() => {
            setShowNewScanModal(false);
            fetchDashboardData(true);
          }}
        />
      )}
    </div>
  );
}
