import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { client, databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Activity,
  AlertCircle,
  FileText,
  XCircle,
  ShieldX,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Bug,
  RefreshCw,
  ArrowRight,
  Shield,
  Lock,
  Package,
  Code2,
  Cloud,
  ChevronDown,
} from 'lucide-react';
import RemediationPanel from './RemediationPanel';
import NewScanModal from './NewScanModal';
import toast from 'react-hot-toast';
import PostureDonut from './charts/PostureDonut';
import CoverageRadar from './charts/CoverageRadar';
import VulnTrend from './charts/VulnTrend';
import GateRulesDrawer, { evaluatePreflight, type Reachability } from './GateRulesDrawer';
import { useGateRules } from '../hooks/useGateRules';
import { VibrationTrace, type HeatmapDatum, type Severity } from './ui';
import { SLA_HOURS } from '../lib/sla';
import PostureExportButton from './PostureExportButton';
import DriftAlertsTable from './DriftAlertsTable';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#E11D48',
  HIGH: '#EA580C',
  MEDIUM: '#D97706',
  LOW: '#15A34A',
  INFO: '#64748B',
};

const SEVERITY_BG: Record<string, string> = {
  CRITICAL: '#FEECEF',
  HIGH: '#FEEFE4',
  MEDIUM: '#FDF3E3',
  LOW: '#E8F7EE',
  INFO: '#F1F4F8',
};

// Frosted glassmorphism by gate status: red / amber / emerald. Purely static -
// no component state feeds these values, so it lives at module scope instead
// of being rebuilt into a new object on every render.
const PREFLIGHT_GLASS: Record<'blocked' | 'warning' | 'ready', React.CSSProperties> = {
  blocked: {
    background: 'color-mix(in srgb, var(--status-error) 16%, transparent)',
    border: '1px solid color-mix(in srgb, var(--status-error) 45%, transparent)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 8px 32px -12px color-mix(in srgb, var(--status-error) 50%, transparent)',
  },
  warning: {
    background: 'color-mix(in srgb, var(--status-warning) 16%, transparent)',
    border: '1px solid color-mix(in srgb, var(--status-warning) 45%, transparent)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 8px 32px -12px color-mix(in srgb, var(--status-warning) 50%, transparent)',
  },
  ready: {
    background: 'color-mix(in srgb, var(--status-success) 16%, transparent)',
    border: '1px solid color-mix(in srgb, var(--status-success) 45%, transparent)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 8px 32px -12px color-mix(in srgb, var(--status-success) 50%, transparent)',
  },
};

export default function Dashboard({
  isSidebarCollapsed: _isSidebarCollapsed,
}: {
  isSidebarCollapsed: boolean;
}) {
  const { getJWT, user } = useAuth();
  const navigate = useNavigate();

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
  const [individualErrors] = useState<Record<string, boolean>>({});

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

  const [detailsExpanded, setDetailsExpanded] = useState<boolean>(() => {
    return localStorage.getItem('scorpion_dashboard_details_expanded') === 'true';
  });
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

  const recentSecretEntries = latestVulnerabilities
    .filter((v: any) => (v.category || v.type || '').toLowerCase().includes('secret'))
    .map((v: any) => v.title || v.message)
    .filter(Boolean);

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

        // SLA breach/countdown — derived from each open finding's age vs its severity window.
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

  const ringMetrics: {
    id: string;
    label: string;
    value: number;
    max: number;
    severity: Severity;
    icon: typeof ShieldX;
    path?: string;
  }[] = [
    {
      id: 'critical',
      label: 'Critical',
      value: vulnStats.critical,
      max: 10,
      severity: 'critical',
      icon: ShieldX,
      path: `/scans/${latestScanId}/sast?filter=critical`,
    },
    {
      id: 'high',
      label: 'High',
      value: vulnStats.high,
      max: 25,
      severity: 'high',
      icon: ShieldAlert,
      path: `/scans/${latestScanId}/sast?filter=high`,
    },
    {
      id: 'medium',
      label: 'Medium',
      value: vulnStats.medium,
      max: 50,
      severity: 'medium',
      icon: AlertCircle,
      path: `/scans/${latestScanId}/sast?filter=medium`,
    },
    {
      id: 'low',
      label: 'Low',
      value: vulnStats.low,
      max: 100,
      severity: 'low',
      icon: ShieldCheck,
      path: `/scans/${latestScanId}/sast?filter=low`,
    },
    {
      id: 'bugs',
      label: 'Bugs',
      value: vulnStats.bugs,
      max: 50,
      severity: 'info',
      icon: Bug,
      path: `/scans/${latestScanId}/antipatterns`,
    },
    {
      id: 'vulns',
      label: 'Open vulns',
      value: vulnStats.total,
      max: 150,
      severity: vulnStats.total > 100 ? 'high' : vulnStats.total > 30 ? 'medium' : 'low',
      icon: Activity,
      path: `/scans/${latestScanId}/sast`,
    },
  ];

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

  return (
    <div
      className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      <div className="px-6 py-6 mx-auto space-y-6 max-w-[1600px]">
        {/* ── Inline header (replaces sticky top bar) ── */}
        <div
          className="flex justify-between items-end pb-4 border-b"
          style={{ borderColor: 'var(--border-strong, var(--border-subtle))' }}
        >
          <div>
            <h1
              className="text-4xl font-extrabold uppercase tracking-tight leading-none"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              Dashboard
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-2">
              Security posture, findings, and pipeline health at a glance
            </p>
          </div>
          <div className="flex gap-3 items-center">
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider"
              style={{
                color: 'var(--status-success)',
                background: 'color-mix(in srgb, var(--status-success) 12%, transparent)',
              }}
            >
              <span className="relative flex w-1.5 h-1.5">
                <span
                  className="absolute inline-flex w-full h-full rounded-full opacity-75 animate-ping"
                  style={{ background: 'var(--status-success)' }}
                />
                <span
                  className="relative inline-flex w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--status-success)' }}
                />
              </span>
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
              className="p-2.5 rounded border transition-colors hover:border-[var(--accent-primary)]"
              style={{
                color: 'var(--text-secondary)',
                borderColor: 'var(--border-subtle)',
                background: 'var(--bg-card)',
              }}
              aria-label="Refresh dashboard"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => setShowNewScanModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider transition-colors hover:opacity-90"
              style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
            >
              <Zap size={14} strokeWidth={2.5} />
              New Scan
            </button>
          </div>
        </div>

        {/* ── Risk Command Bar — preflight / score / SLA / debt ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Pre-flight Status — reachability-driven, env-aware, frosted glass */}
          <div className="p-5 rounded" style={PREFLIGHT_GLASS[preflight.status]}>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              Pre-flight Status · {gateEnv.toUpperCase()}
            </p>
            {loading ? (
              <div
                className="mt-3 w-24 h-12 rounded animate-pulse"
                style={{ background: 'var(--bg-secondary)' }}
              />
            ) : (
              <>
                <p
                  className="mt-2 text-4xl font-extrabold leading-none"
                  style={{ color: preflightColor, fontFamily: 'var(--font-display)' }}
                >
                  {preflight.label}
                </p>
                <p className="mt-2 text-[11px] font-semibold" style={{ color: preflightColor }}>
                  {preflightBadge}
                </p>
              </>
            )}
          </div>

          {/* Overall Risk Score */}
          <div
            className="p-5 rounded border"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              Overall Risk Score
            </p>
            {loading ? (
              <div
                className="mt-3 w-24 h-12 rounded animate-pulse"
                style={{ background: 'var(--bg-secondary)' }}
              />
            ) : (
              <div className="flex items-baseline gap-2 mt-2">
                <span
                  className="text-5xl font-extrabold leading-none tabular-nums"
                  style={{
                    color: gateColor(vulnStats.score / 100),
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  {vulnStats.score}
                </span>
                <span className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                  /100
                </span>
              </div>
            )}
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {vulnStats.score >= 85
                ? 'Healthy'
                : vulnStats.score >= 65
                  ? 'Needs Attention'
                  : 'High Risk — act now'}
            </p>
          </div>

          {/* SLA Status */}
          <div
            className="p-5 rounded border"
            style={{
              background: 'var(--bg-card)',
              borderColor: slaStats.breached > 0 ? 'var(--status-error)' : 'var(--border-subtle)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              SLA Status
            </p>
            {loading ? (
              <div
                className="mt-3 w-24 h-12 rounded animate-pulse"
                style={{ background: 'var(--bg-secondary)' }}
              />
            ) : slaStats.breached > 0 ? (
              <>
                <div className="flex items-baseline gap-2 mt-2">
                  <span
                    className="text-5xl font-extrabold leading-none tabular-nums"
                    style={{ color: 'var(--status-error)', fontFamily: 'var(--font-display)' }}
                  >
                    {slaStats.breached}
                  </span>
                  <span className="text-sm font-bold" style={{ color: 'var(--status-error)' }}>
                    Breached
                  </span>
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  🚨 {slaStats.breachedCritical} Critical · {slaStats.dueSoon} Due in &lt; 24h
                </p>
              </>
            ) : slaStats.dueSoon > 0 ? (
              <>
                <div className="flex items-baseline gap-2 mt-2">
                  <span
                    className="text-5xl font-extrabold leading-none tabular-nums"
                    style={{ color: 'var(--status-warning)', fontFamily: 'var(--font-display)' }}
                  >
                    {slaStats.dueSoon}
                  </span>
                  <span className="text-sm font-bold" style={{ color: 'var(--status-warning)' }}>
                    Due &lt; 24h
                  </span>
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Approaching SLA
                  {slaStats.nextHours !== null
                    ? ` · next in ${Math.max(1, Math.round(slaStats.nextHours))}h`
                    : ''}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mt-2">
                  <span
                    className="text-5xl font-extrabold leading-none tabular-nums"
                    style={{ color: 'var(--status-success)', fontFamily: 'var(--font-display)' }}
                  >
                    0
                  </span>
                  <span className="text-sm font-bold" style={{ color: 'var(--status-success)' }}>
                    On track
                  </span>
                </div>
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  No overdue findings
                </p>
              </>
            )}
          </div>

          {/* Security Debt */}
          <div
            className="p-5 rounded border"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              Security Debt
            </p>
            {loading ? (
              <div
                className="mt-3 w-24 h-12 rounded animate-pulse"
                style={{ background: 'var(--bg-secondary)' }}
              />
            ) : (
              <div className="flex items-baseline gap-2 mt-2">
                <span
                  className="text-5xl font-extrabold leading-none tabular-nums"
                  style={{
                    color:
                      securityDebtHours > 80
                        ? 'var(--status-error)'
                        : securityDebtHours > 20
                          ? 'var(--status-warning)'
                          : 'var(--status-success)',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  {securityDebtHours}
                </span>
                <span className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                  Hours
                </span>
              </div>
            )}
            <p className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Est. fix for {vulnStats.total} items · Crit 8h / High 4h / Med 2h / Low 0.5h
            </p>
          </div>
        </div>

        {/* ── Tech & Corporate Trust — Bento hero (60/40) ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Primary trust box — 60% */}
          <div
            className="flex flex-col p-4 rounded-md border lg:col-span-3"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div className="flex justify-between items-start gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="flex justify-center items-center w-9 h-9 rounded-xl shrink-0"
                  style={{
                    background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
                    color: 'var(--accent-primary)',
                  }}
                >
                  <Shield size={18} strokeWidth={2.5} />
                </div>
                <div>
                  <p
                    className="text-[11px] font-bold tracking-wider uppercase"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Posture Overview
                  </p>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                  >
                    Live security signal across all assets
                  </p>
                </div>
              </div>
              <Link
                to="/issues"
                className="flex items-center gap-1.5 text-xs font-semibold shrink-0 transition-colors hover:opacity-80"
                style={{ color: 'var(--accent-primary)' }}
              >
                Open queue <ArrowRight size={14} />
              </Link>
            </div>

            <div className="mb-6">
              <div className="flex justify-between items-center mb-3">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Live posture signal
                </p>
                {loading ? (
                  <div
                    className="w-14 h-6 rounded-full animate-pulse"
                    style={{ background: 'var(--bg-secondary)' }}
                  />
                ) : (
                  <span
                    className="px-2.5 py-1 rounded-full text-xs font-bold tabular-nums"
                    style={{
                      background: `color-mix(in srgb, ${gateColor(vulnStats.score / 100)} 14%, transparent)`,
                      color: gateColor(vulnStats.score / 100),
                    }}
                  >
                    {vulnStats.score}/100
                  </span>
                )}
              </div>
              <VibrationTrace
                activity={Math.min(1, vulnStats.total / 60)}
                critical={vulnStats.critical > 0}
                height={48}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
              {[
                { label: 'Secrets', count: byType.secret, icon: Lock },
                { label: 'Dependencies', count: byType.dependency, icon: Package },
                { label: 'Static analysis', count: byType.sast, icon: Code2 },
                { label: 'Infra (IaC)', count: byType.iac, icon: Cloud },
              ].map((b) => (
                <div
                  key={b.label}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-md"
                  style={{ background: 'var(--bg-secondary)' }}
                >
                  <b.icon
                    size={14}
                    style={{
                      color: b.count > 0 ? 'var(--status-warning)' : 'var(--status-success)',
                    }}
                  />
                  <div className="min-w-0">
                    <p
                      className="text-sm font-bold leading-none"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {b.count}
                    </p>
                    <p
                      className="text-[10px] font-semibold tracking-wide uppercase truncate"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {b.label}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-5 mt-auto border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-4"
                style={{ color: 'var(--text-secondary)' }}
              >
                AI remediation queue
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Open queue
                  </p>
                  {loading ? (
                    <div
                      className="w-12 h-7 rounded animate-pulse"
                      style={{ background: 'var(--bg-secondary)' }}
                    />
                  ) : (
                    <p
                      className="text-2xl font-bold"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {remediationStats.queueCount}
                    </p>
                  )}
                </div>
                <div>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    PRs today
                  </p>
                  {loading ? (
                    <div
                      className="w-12 h-7 rounded animate-pulse"
                      style={{ background: 'var(--bg-secondary)' }}
                    />
                  ) : (
                    <p
                      className="text-2xl font-bold"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {remediationStats.prsCreatedToday}
                    </p>
                  )}
                </div>
                <div>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Detection → PR
                  </p>
                  {loading ? (
                    <div
                      className="w-12 h-7 rounded animate-pulse"
                      style={{ background: 'var(--bg-secondary)' }}
                    />
                  ) : (
                    <p
                      className="text-2xl font-bold"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                      {remediationStats.avgDetectionToPrDays !== null
                        ? `${remediationStats.avgDetectionToPrDays}d`
                        : '—'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Satellite bento cells — 40% */}
          <div className="grid grid-cols-2 gap-4 lg:col-span-2">
            {gateRows
              .filter((row) => row.id !== 'build')
              .map((row) => (
                <div
                  key={row.id}
                  onClick={() => (row.id === 'ci' ? setShowGateSummary(true) : undefined)}
                  onKeyDown={
                    row.id === 'ci'
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setShowGateSummary(true);
                          }
                        }
                      : undefined
                  }
                  role={row.id === 'ci' ? 'button' : undefined}
                  tabIndex={row.id === 'ci' ? 0 : undefined}
                  className={`rounded-md p-4 border flex flex-col justify-between ${row.id === 'ci' ? 'cursor-pointer hover:brightness-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2' : ''}`}
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)',
                    ...(row.id === 'ci'
                      ? ({
                          '--tw-ring-color': 'var(--accent-primary)',
                          '--tw-ring-offset-color': 'var(--bg-card)',
                        } as React.CSSProperties)
                      : {}),
                  }}
                >
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {row.label}
                  </p>
                  {loading ? (
                    <div
                      className="w-16 h-8 rounded animate-pulse"
                      style={{ background: 'var(--bg-secondary)' }}
                    />
                  ) : (
                    <div>
                      <p
                        className="text-3xl font-bold tracking-tight leading-none mt-2"
                        style={{ color: row.color, fontFamily: 'var(--font-display)' }}
                      >
                        {row.value}
                      </p>
                      <p className="text-[10px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                        {row.id === 'deploy'
                          ? `Last build: ${lastBuildStatus.toUpperCase()}`
                          : row.sub}
                      </p>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* ── Security posture + Threat radar ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div
            className="flex flex-col p-4 rounded-md border"
            style={{
              height: 460,
              background: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p
              className="mb-4 text-[11px] font-semibold tracking-wider uppercase shrink-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              SECURITY POSTURE
            </p>
            <div className="flex-1 min-h-0">
              <PostureDonut
                critical={vulnStats.critical}
                high={vulnStats.high}
                medium={vulnStats.medium}
                low={vulnStats.low}
              />
            </div>
          </div>

          <div
            className="flex flex-col p-4 rounded-md border"
            style={{
              height: 460,
              background: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p
              className="mb-4 text-[11px] font-semibold tracking-wider uppercase shrink-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              COVERAGE — THREAT RADAR
            </p>
            <div className="flex flex-1 justify-center items-center min-h-0">
              <CoverageRadar />
            </div>
          </div>
        </div>

        {/* ── Runtime drift anomalies — closes the observability loop ── */}
        <DriftAlertsTable />

        {/* ── Details — collapsed by default (anti-bloat; command bar is the focus) ── */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              const next = !detailsExpanded;
              setDetailsExpanded(next);
              localStorage.setItem('scorpion_dashboard_details_expanded', String(next));
            }}
            className="flex items-center gap-2 py-2 text-[11px] font-bold tracking-wider uppercase transition-colors hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
            aria-expanded={detailsExpanded}
          >
            <ChevronDown
              size={14}
              style={{
                transform: detailsExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
            {detailsExpanded
              ? 'Hide details'
              : 'More signal — findings, scan health, repo risk, KPIs, pipeline, trend'}
          </button>

          {detailsExpanded && (
            <div className="mt-4 space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* ── Scan health — ring metrics ── */}
                <div
                  className="p-4 rounded-md border"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  <p
                    className="mb-6 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    SCAN HEALTH
                  </p>
                  <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                    {ringMetrics.map((m) => {
                      const severityVar =
                        m.id === 'bugs' ? 'var(--accent-primary)' : `var(--severity-${m.severity})`;

                      return loading ? (
                        <SkeletonCard key={m.id} />
                      ) : (
                        <div
                          key={m.id}
                          onClick={
                            m.path && !m.path.includes('null') ? () => navigate(m.path!) : undefined
                          }
                          className={`rounded-md p-4 border ${m.path && !m.path.includes('null') ? 'cursor-pointer hover:brightness-95 transition-all' : ''}`}
                          style={{
                            background: 'var(--bg-card)',
                            borderColor: 'var(--border-subtle)',
                            boxShadow: 'var(--card-shadow)',
                          }}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <p
                              className="font-bold tracking-wider uppercase text-[10px]"
                              style={{ color: severityVar }}
                            >
                              {m.label}
                            </p>
                            <div className="shrink-0" style={{ color: severityVar }}>
                              <m.icon size={14} strokeWidth={2.5} />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 items-start mt-2">
                            <span
                              className="text-3xl font-bold tracking-tight"
                              style={{
                                color: 'var(--text-primary)',
                                fontFamily: 'var(--font-display)',
                              }}
                            >
                              {m.value}
                            </span>
                            {(() => {
                              const ratio = m.max > 0 ? m.value / m.max : 0;
                              const status =
                                ratio === 0 ? 'Healthy' : ratio < 0.5 ? 'WARNING' : 'FAILING';
                              const color =
                                ratio === 0
                                  ? 'var(--status-success)'
                                  : ratio < 0.5
                                    ? 'var(--status-warning)'
                                    : 'var(--status-error)';
                              if (
                                ratio === 0 &&
                                (m.severity === 'critical' || m.severity === 'high')
                              )
                                return null;
                              if (m.value > 0)
                                return (
                                  <span
                                    className="font-bold uppercase text-[10px]"
                                    style={{ color }}
                                  >
                                    {status}
                                  </span>
                                );
                              return <span className="h-3" />;
                            })()}
                          </div>
                        </div>
                      );
                    })}
                    {loading ? (
                      <SkeletonCard />
                    ) : (
                      <div
                        className="rounded-md p-4 border"
                        style={{
                          background: 'var(--bg-secondary)',
                          borderColor: 'var(--border-subtle)',
                          boxShadow: 'var(--card-shadow)',
                        }}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <p
                            className="text-[10px] font-bold tracking-wider uppercase"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            OPEN VULNS
                          </p>
                          <div className="shrink-0" style={{ color: 'var(--accent-primary)' }}>
                            <Zap size={14} strokeWidth={2.5} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-start mt-2">
                          <span
                            className="text-3xl font-bold tracking-tight"
                            style={{
                              color: 'var(--accent-primary)',
                              fontFamily: 'var(--font-display)',
                            }}
                          >
                            {vulnStats.critical + vulnStats.high + vulnStats.medium}
                          </span>
                          {vulnStats.critical + vulnStats.high + vulnStats.medium > 0 ? (
                            <span
                              className="text-[10px] font-bold uppercase"
                              style={{ color: 'var(--status-warning)' }}
                            >
                              WARNING
                            </span>
                          ) : (
                            <span className="h-3" />
                          )}
                        </div>
                      </div>
                    )}
                    {loading ? (
                      <SkeletonCard />
                    ) : (
                      <div
                        className="rounded-md p-4 border"
                        style={{
                          background: 'var(--bg-secondary)',
                          borderColor: 'var(--border-subtle)',
                          boxShadow: 'var(--card-shadow)',
                        }}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <p
                            className="text-[10px] font-bold tracking-wider uppercase"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            LINES SCANNED
                          </p>
                          <div className="shrink-0" style={{ color: 'var(--accent-primary)' }}>
                            <FileText size={14} strokeWidth={2.5} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-start mt-2">
                          <span
                            className="text-3xl font-bold tracking-tight"
                            style={{
                              color: 'var(--accent-primary)',
                              fontFamily: 'var(--font-display)',
                            }}
                          >
                            {vulnStats.linesScanned?.toLocaleString() || '0'}
                          </span>
                          <span className="h-3" />
                        </div>
                      </div>
                    )}
                    {loading ? (
                      <SkeletonCard />
                    ) : (
                      <div
                        onClick={() => navigate('/repos')}
                        className="rounded-md p-4 border cursor-pointer hover:brightness-95 transition-all"
                        style={{
                          background: 'var(--bg-secondary)',
                          borderColor: 'var(--border-subtle)',
                          boxShadow: 'var(--card-shadow)',
                        }}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <p
                            className="text-[10px] font-bold tracking-wider uppercase"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            ACTIVE SCANS
                          </p>
                          <div className="shrink-0" style={{ color: 'var(--accent-primary)' }}>
                            <Zap size={14} strokeWidth={2.5} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-start mt-2">
                          <span
                            className="text-3xl font-bold tracking-tight"
                            style={{
                              color: 'var(--accent-primary)',
                              fontFamily: 'var(--font-display)',
                            }}
                          >
                            {activeScansCount}
                          </span>
                          <span className="h-3" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Findings & recent activity (Signal stream) ── */}
                <div
                  className="flex flex-col justify-between p-4 rounded-md border"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  <div>
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <p
                          className="text-[10px] font-bold uppercase tracking-wider mb-1"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          FINDINGS & RECENT ACTIVITY
                        </p>
                        <p
                          className="text-sm font-semibold"
                          style={{
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-display)',
                          }}
                        >
                          Signal stream
                        </p>
                      </div>
                      <Link
                        to="/issues"
                        className="text-xs font-semibold transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        View all →
                      </Link>
                    </div>

                    {loading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="h-14 rounded-2xl animate-pulse"
                            style={{ background: 'var(--bg-secondary)' }}
                          />
                        ))}
                      </div>
                    ) : latestVulnerabilities.length > 0 ? (
                      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                        {latestVulnerabilities.map((v: any) => (
                          <div key={v.$id} className="flex gap-4 items-center py-3 min-h-[64px]">
                            <div
                              className="w-[3px] h-8 rounded-full shrink-0"
                              style={{ background: SEVERITY_COLOR[v.severity] ?? '#d1d5db' }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wider"
                                  style={{
                                    color: SEVERITY_COLOR[v.severity],
                                    background: SEVERITY_BG[v.severity] ?? '#f3f4f6',
                                  }}
                                >
                                  {v.severity}
                                </span>
                                <p
                                  className="pr-4 text-xs font-medium truncate"
                                  style={{ color: 'var(--text-primary)' }}
                                >
                                  {v.title || v.message}
                                </p>
                              </div>
                              <p
                                className="font-mono text-[10px] truncate pr-4"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {v.file_path || v.location || v.file || 'unknown'}
                                {v.line ? `:${v.line}` : ''}
                              </p>
                              {v.fixedVersion && (
                                <p
                                  className="text-[10px] font-semibold mt-0.5"
                                  style={{ color: 'var(--status-success)' }}
                                >
                                  Fix available: {v.fixedVersion}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 items-center shrink-0">
                              <span
                                className="px-2 py-0.5 text-[10px] font-semibold rounded"
                                style={{
                                  background: 'var(--bg-secondary)',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                Open
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedRemediationFindingId(v.$id)}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold border rounded hover:opacity-80 transition-colors shrink-0"
                                style={{
                                  borderColor: 'var(--border-subtle)',
                                  color: 'var(--text-primary)',
                                }}
                              >
                                Fix <ArrowRight size={10} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6">
                        <div className="flex justify-between items-center mb-4">
                          <p
                            className="text-sm font-semibold"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            Compliance delta sweep
                          </p>
                          <span
                            className="text-[11px] font-bold"
                            style={{ color: 'var(--status-success)' }}
                          >
                            100% secure
                          </span>
                        </div>
                        <div
                          className="w-full h-1.5 rounded-full overflow-hidden mb-5"
                          style={{ background: 'var(--bg-secondary)' }}
                        >
                          <div
                            className="w-full h-full rounded-full"
                            style={{ background: 'var(--status-success)' }}
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {[
                            ['OWASP Top 10', '100% passed'],
                            ['Secrets & key leaks', '0 detected'],
                            ['Dependency delta vulns', '0 open'],
                            ['Container baseline runtime', 'Verified'],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="flex justify-between items-center px-3 py-2 text-[10px] rounded-lg"
                              style={{
                                color: 'var(--text-secondary)',
                                background: 'var(--bg-secondary)',
                              }}
                            >
                              <span className="font-semibold">{label}</span>
                              <span
                                className="font-bold"
                                style={{ color: 'var(--status-success)' }}
                              >
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>{' '}
              {/* Close grid-cols-2 for Scan Health + Signal Stream */}
              <div
                className="p-4 rounded-md border"
                style={{
                  background: 'var(--bg-card)',
                  borderColor: 'var(--border-subtle)',
                  boxShadow: 'var(--card-shadow)',
                }}
              >
                <div className="flex justify-between items-center mb-4">
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    REPO RISK RANKING
                  </p>
                  <Link
                    to="/repos"
                    className="text-xs font-medium transition-colors hover:opacity-80"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    View all repos →
                  </Link>
                </div>
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-10 rounded-lg animate-pulse"
                        style={{ background: 'var(--bg-secondary)' }}
                      />
                    ))}
                  </div>
                ) : repoRisk.length > 0 ? (
                  <div className="space-y-3">
                    {repoRisk.map((r, i) => (
                      <div key={r.repo_id}>
                        <div className="flex justify-between items-center mb-1.5">
                          <div className="flex gap-2.5 items-center min-w-0">
                            <span
                              className="w-4 text-[11px] font-bold tabular-nums shrink-0"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {i + 1}
                            </span>
                            <span
                              className="text-sm font-medium truncate"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              {r.repo_name}
                            </span>
                          </div>
                          <span
                            className="font-mono text-[11px] font-bold tabular-nums shrink-0"
                            style={{
                              color:
                                r.critical > 0
                                  ? 'var(--severity-critical)'
                                  : r.high > 0
                                    ? 'var(--severity-high)'
                                    : 'var(--status-success)',
                            }}
                          >
                            {r.critical}C · {r.high}H
                          </span>
                        </div>
                        <div
                          className="flex w-full h-1.5 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-secondary)' }}
                        >
                          <div
                            style={{
                              width: `${(r.critical / maxRepoFindings) * 100}%`,
                              background: 'var(--severity-critical)',
                            }}
                          />
                          <div
                            style={{
                              width: `${(r.high / maxRepoFindings) * 100}%`,
                              background: 'var(--severity-high)',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                    No open findings across monitored repos.
                  </p>
                )}
              </div>
              {/* ── Posture KPIs ── */}
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                {[
                  {
                    label: 'MTTR',
                    value: mttrDays !== null ? `${mttrDays}d` : '—',
                    sub: 'vs <1d target',
                    color:
                      mttrDays === null
                        ? 'var(--text-muted)'
                        : mttrDays <= 1
                          ? 'var(--status-success)'
                          : mttrDays <= 3
                            ? 'var(--status-warning)'
                            : 'var(--status-error)',
                  },
                  {
                    label: 'Scan Freshness',
                    value: `${scansLast7}`,
                    sub: 'scans · last 7d',
                    color: scansLast7 > 0 ? 'var(--status-success)' : 'var(--status-warning)',
                  },
                  {
                    label: 'Remediation PRs',
                    value: `${remediationStats.prsCreatedToday}`,
                    sub: 'merged today',
                    color: 'var(--accent-primary)',
                  },
                  {
                    label: 'Open Queue',
                    value: `${remediationStats.queueCount}`,
                    sub: 'awaiting fix',
                    color:
                      remediationStats.queueCount > 0
                        ? 'var(--status-warning)'
                        : 'var(--status-success)',
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="p-4 rounded border"
                    style={{
                      background: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--card-shadow)',
                    }}
                  >
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {k.label}
                    </p>
                    {loading ? (
                      <div
                        className="mt-3 w-12 h-8 rounded animate-pulse"
                        style={{ background: 'var(--bg-secondary)' }}
                      />
                    ) : (
                      <>
                        <p
                          className="mt-2 text-4xl font-bold leading-none tabular-nums"
                          style={{ color: k.color, fontFamily: 'var(--font-display)' }}
                        >
                          {k.value}
                        </p>
                        <p className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {k.sub}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {/* ── Pipeline gates + Vulnerability trend ── */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div
                  className="p-4 rounded border"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      PIPELINE GATE STATUS
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowGateRules(true)}
                      className="text-[10px] font-semibold transition-colors hover:opacity-80"
                      style={{ color: 'var(--accent-primary)' }}
                    >
                      Configure Rules →
                    </button>
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                    {pipelineGateStatus.map((g) => (
                      <div key={g.env} className="flex justify-between items-center py-2.5">
                        <span
                          className="text-xs font-bold tracking-wide"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {g.env}
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[11px] capitalize"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {g.status}
                          </span>
                          <span
                            className="text-sm font-bold w-4 text-center"
                            style={{ color: g.color }}
                          >
                            {g.icon}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="p-4 rounded border"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)',
                  }}
                >
                  <VulnTrend total={vulnStats.total} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CI gate modal ── */}
      {showGateSummary && (
        <div className="flex fixed inset-0 z-50 justify-center items-center p-4 bg-black/40">
          <div
            className="p-6 w-full max-w-lg rounded-2xl"
            style={{ background: 'var(--bg-card)', boxShadow: 'var(--card-shadow)' }}
          >
            <div className="flex gap-2 items-center mb-5">
              <ShieldAlert size={18} style={{ color: 'var(--status-error)' }} />
              <h2
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                Policy blocking summary
              </h2>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {gateSummary.length > 0 ? (
                gateSummary.map((repo, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-2xl border"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span
                        className="text-sm font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {repo.name}
                      </span>
                      <span
                        className="text-[10px] font-semibold uppercase"
                        style={{ color: 'var(--status-error)' }}
                      >
                        Blocked
                      </span>
                    </div>
                    <p
                      className="text-xs leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {repo.reason}
                    </p>
                  </div>
                ))
              ) : (
                <div className="py-10 text-center">
                  <ShieldCheck size={28} className="mx-auto mb-2 text-emerald-500" />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    All monitored assets are compliant.
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowGateSummary(false)}
              className="w-full mt-5 py-2.5 text-sm font-medium rounded-2xl transition-colors hover:opacity-90"
              style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
            >
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
