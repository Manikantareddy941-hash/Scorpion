import { dashboardRepository } from '../repositories/dashboardRepository';
import { canAccessResource } from './tenancyService';
import { logger } from './logger';

/**
 * SLA window per severity, in hours. Mirrors src/lib/sla.ts on the frontend,
 * which is where this used to be computed from findings pulled straight into
 * the browser. Unknown severities fall back to the medium window, matching the
 * previous `?? 168` behaviour.
 */
const SLA_HOURS: Record<string, number> = { critical: 24, high: 72, medium: 168, low: 720 };
const DEFAULT_SLA_HOURS = 168;
const DUE_SOON_HOURS = 24;
const HOUR_MS = 3600_000;

const emptySla = (): SlaSummary => ({ breached: 0, dueSoon: 0, breachedCritical: 0, nextHours: null });

/** How many recent findings to consider, and how many to surface from them.
 *  Mirrors what the dashboard previously fetched directly from Appwrite. */
const RECENT_FINDINGS_WINDOW = 50;
const RECENT_FINDINGS_SHOWN = 5;
import {
  DashboardMetrics,
  FindingDocument,
  PostureBreakdown,
  SecurityDashboardStats,
  SeverityCounts,
  SlaSummary,
  TypeCounts
} from '../types/dashboard.types';

const dashboardCache = new Map<string, { data: SecurityDashboardStats; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 60 seconds
// The TTL only decides whether an entry is *served*; it never removed one. Every
// distinct userId that ever hit the dashboard kept a full stats object resident
// for the process lifetime, so the ceiling was "all users who have ever logged
// in" rather than "users active in the last minute". Bounded + swept on write.
const CACHE_MAX_ENTRIES = 500;

function rememberDashboard(userId: string, data: SecurityDashboardStats, now: number = Date.now()): void {
  for (const [key, entry] of dashboardCache) {
    if (now - entry.timestamp >= CACHE_TTL) dashboardCache.delete(key);
  }
  // Insertion order is oldest-first, so the first key is the coldest write.
  while (dashboardCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = dashboardCache.keys().next().value;
    if (oldest === undefined) break;
    dashboardCache.delete(oldest);
  }
  dashboardCache.set(userId, { data, timestamp: now });
}

const emptySeverity = (): SeverityCounts => ({ critical: 0, high: 0, medium: 0, low: 0 });
const emptyTypeCounts = (): TypeCounts => ({ secret: 0, dependency: 0, sast: 0, docker: 0, iac: 0 });

function normalizeSeverity(rawSeverity: unknown): keyof SeverityCounts {
  const severity = String(rawSeverity || 'low').toLowerCase();
  return (severity === 'crit' ? 'critical' : severity) as keyof SeverityCounts;
}

function normalizeType(finding: FindingDocument): keyof TypeCounts {
  let type = (finding.type || 'dependency').toLowerCase();
  const tool = (finding.tool || '').toLowerCase();
  const titleAndMessage = `${finding.title || ''} ${finding.message || ''}`;
  if (tool.includes('gitleaks') || tool.includes('secret')) type = 'secret';
  if (tool.includes('semgrep') || tool.includes('sast')) type = 'sast';
  if (tool.includes('trivy') && finding.title?.includes('image')) type = 'docker';
  if (tool.includes('trivy') && (titleAndMessage.includes('[IaC]') || titleAndMessage.includes('[CONFIG]'))) type = 'iac';
  if (tool.includes('trivy') && !type) type = 'dependency';
  return type as keyof TypeCounts;
}

export const dashboardService = {
  async getSecurityDashboard(userId: string): Promise<SecurityDashboardStats> {
    const cached = dashboardCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.info(`[Dashboard] Serving cached data for ${userId}`);
      return cached.data;
    }

    const teamIds = await dashboardRepository.getUserTeamIds(userId);
    const reposResponse = await dashboardRepository.listUserRepos(userId, teamIds);

    const repoIds = reposResponse.documents.map(r => r.$id);
    const repoNames: Record<string, string> = {};
    reposResponse.documents.forEach(r => repoNames[r.$id] = r.name || '');

    if (repoIds.length === 0) {
      return {
        total: 0,
        by_severity: emptySeverity(),
        by_type: emptyTypeCounts(),
        by_type_severity: {
          secret: emptySeverity(), dependency: emptySeverity(), sast: emptySeverity(),
          docker: emptySeverity(), iac: emptySeverity()
        },
        by_repo: [],
        trend: [],
        open_count: 0,
        resolved_count: 0,
        remediated_today: 0,
        mttr_today_days: null,
        mttr_days: null,
        sla: emptySla(),
        recent_findings: [],
        latest_scan: null
      };
    }

    const repoUrls = reposResponse.documents.map(r => r.url).filter((u): u is string => Boolean(u));
    const scansResponse = await dashboardRepository.listScansForRepos(repoIds, repoUrls);
    const scanIds = scansResponse.documents.map(s => s.$id);

    const findingsResponse = await dashboardRepository.listFindingsForReposOrScans(repoIds, scanIds);
    const findings = findingsResponse.documents;

    const stats: SecurityDashboardStats = {
      total: findingsResponse.total,
      by_severity: emptySeverity(),
      by_type: emptyTypeCounts(),
      by_type_severity: {
        secret: emptySeverity(), dependency: emptySeverity(), sast: emptySeverity(),
        docker: emptySeverity(), iac: emptySeverity()
      },
      by_repo: [],
      trend: [],
      open_count: 0,
      resolved_count: 0,
      remediated_today: 0,
      mttr_today_days: null,
      mttr_days: null,
      sla: emptySla(),
      // Newest first, then highest risk among those. risk_score is absent on
      // documents written before it existed, so it is coalesced rather than
      // sorted on in the query — a server-side orderDesc would 400 on an
      // unmigrated collection.
      recent_findings: [...findings]
        .sort((a, b) => new Date(b.$createdAt).getTime() - new Date(a.$createdAt).getTime())
        .slice(0, RECENT_FINDINGS_WINDOW)
        .sort((a, b) => Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0))
        .slice(0, RECENT_FINDINGS_SHOWN),
      // listScansForRepos already orders newest-first, so the head is the latest.
      latest_scan: scansResponse.documents[0] ?? null,
      findings
    };

    // Local midnight: "today" means the viewer's day, matching what the
    // dashboard label claims.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayMs = startOfDay.getTime();

    const repoCounts: Record<string, { total: number; critical: number; high: number }> = {};
    const trendCounts: Record<string, number> = {};
    const resolutionDurationsMs: number[] = [];
    const todayResolutionDurationsMs: number[] = [];

    // Map scanId to repoId for fallback
    const scanToRepo: Record<string, string> = {};
    scansResponse.documents.forEach(s => {
      scanToRepo[s.$id] = s.repo_id || s.repoUrl || '';
    });

    // Initialize trend for last 30 days
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      trendCounts[date.toISOString().split('T')[0]] = 0;
    }

    for (const finding of findings) {
      const normalizedSeverity = normalizeSeverity(finding.severity);
      if (normalizedSeverity in stats.by_severity) {
        stats.by_severity[normalizedSeverity]++;
      }

      const type = normalizeType(finding);
      if (type in stats.by_type) {
        stats.by_type[type]++;
        if (stats.by_type_severity[type]) {
          stats.by_type_severity[type][normalizedSeverity] = (stats.by_type_severity[type][normalizedSeverity] || 0) + 1;
        }
      }

      // Repo identification (with fallback)
      const repoId = finding.repo_id || (finding.scanId ? scanToRepo[finding.scanId] : undefined);
      if (repoId) {
        if (!repoCounts[repoId]) repoCounts[repoId] = { total: 0, critical: 0, high: 0 };
        repoCounts[repoId].total++;
        if (normalizedSeverity === 'critical') repoCounts[repoId].critical++;
        if (normalizedSeverity === 'high') repoCounts[repoId].high++;
      }

      // Trend
      const dateStr = finding.$createdAt.split('T')[0];
      if (dateStr in trendCounts) {
        trendCounts[dateStr]++;
      }

      // Status
      if (finding.status === 'resolved' || finding.status === 'remediated') {
        stats.resolved_count++;
        // $updatedAt reflects the last write to the document, which for a resolved
        // finding is when its status flipped — used as a proxy resolution timestamp
        // since there is no dedicated resolvedAt field on this collection.
        const created = new Date(finding.$createdAt).getTime();
        const resolved = new Date(finding.$updatedAt).getTime();
        if (resolved > created) resolutionDurationsMs.push(resolved - created);
        if (resolved >= startOfDayMs) {
          stats.remediated_today++;
          if (resolved > created) todayResolutionDurationsMs.push(resolved - created);
        }
      } else {
        stats.open_count++;

        // SLA posture, previously computed in the browser over 200 findings
        // fetched directly from Appwrite.
        const severity = String(finding.severity ?? '').toLowerCase();
        const windowHours = SLA_HOURS[severity] ?? DEFAULT_SLA_HOURS;
        const hoursLeft =
          (new Date(finding.$createdAt).getTime() + windowHours * HOUR_MS - Date.now()) / HOUR_MS;
        if (hoursLeft <= 0) {
          stats.sla.breached++;
          if (severity === 'critical') stats.sla.breachedCritical++;
        } else {
          if (hoursLeft <= DUE_SOON_HOURS) stats.sla.dueSoon++;
          stats.sla.nextHours =
            stats.sla.nextHours === null ? hoursLeft : Math.min(stats.sla.nextHours, hoursLeft);
        }
      }
    }

    const meanDays = (durations: number[]): number | null => {
      if (durations.length === 0) return null;
      const avgMs = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
      return Math.round((avgMs / (1000 * 60 * 60 * 24)) * 10) / 10;
    };
    stats.mttr_days = meanDays(resolutionDurationsMs);
    stats.mttr_today_days = meanDays(todayResolutionDurationsMs);

    stats.by_repo = Object.entries(repoCounts).map(([id, counts]) => ({
      repo_id: id,
      repo_name: repoNames[id] || (id.includes('/') ? id.split('/').pop()?.replace('.git', '') : 'Unknown') || 'Unknown',
      count: counts.total,
      critical: counts.critical,
      high: counts.high
    }));

    stats.trend = Object.entries(trendCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    rememberDashboard(userId, stats);

    return stats;
  },

  async getPostureBreakdown(userId: string): Promise<PostureBreakdown> {
    const reposResponse = await dashboardRepository.listUserRepos(userId);
    const repos = reposResponse.documents;

    if (repos.length === 0) {
      return { score: 0, breakdown: [], recommendations: ['Add a repository to begin monitoring.'] };
    }

    const repoIds = repos.map(r => r.$id);
    const findings = await dashboardRepository.listOpenFindingsForRepos(repoIds);

    const critical = findings.documents.filter(f => f.severity === 'critical').length;
    const high = findings.documents.filter(f => f.severity === 'high').length;
    const medium = findings.documents.filter(f => f.severity === 'medium').length;

    const criticalPenalty = critical * 5;
    const highPenalty = high * 2;
    const mediumPenalty = medium * 0.5;

    const passCount = repos.filter(r => r.gate_status === 'passed' || (r.security_score ?? 0) >= 70).length;
    const passRate = (passCount / repos.length) * 100;
    const gatePenalty = (100 - passRate) * 0.3;

    const totalPenalty = criticalPenalty + highPenalty + mediumPenalty + gatePenalty;
    const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

    const breakdown = [
      { category: 'Critical Vulnerabilities', impact: Math.round(criticalPenalty), count: critical },
      { category: 'High Vulnerabilities', impact: Math.round(highPenalty), count: high },
      { category: 'Medium Vulnerabilities', impact: Math.round(mediumPenalty), count: medium },
      { category: 'CI Gate Compliance', impact: Math.round(gatePenalty), rate: `${Math.round(passRate)}%` }
    ];

    const recommendations: string[] = [];
    if (critical > 0) recommendations.push(`Remediate ${critical} critical findings immediately to boost score by ~${Math.round(criticalPenalty)}%.`);
    if (high > 0) recommendations.push(`Address ${high} high severity issues to improve posture by ~${Math.round(highPenalty)}%.`);
    if (passRate < 90) recommendations.push(`Improve CI gate pass rate (currently ${Math.round(passRate)}%) by fixing policy blockers.`);

    return { score, breakdown, recommendations: recommendations.slice(0, 3) };
  },

  async generateAiBlueprint(taskId: string, userId: string): Promise<{ forbidden: true } | { forbidden: false; blueprint: string }> {
    const task = await dashboardRepository.getFinding(taskId);
    const repo = task.repo_id ? await dashboardRepository.getRepository(task.repo_id) : null;
    if (!repo || !(await canAccessResource(repo, userId))) {
      return { forbidden: true };
    }

    const prompt = `You are a DevOps Engineer. Create a step-by-step markdown blueprint to remediate this finding:
        Title: ${task.title || task.name}
        Severity: ${task.severity}
        Type: ${task.type}
        File: ${task.file_path || task.filePath || 'Unknown'}
        Repository: ${task.repo_name || task.repositoryName || 'Unknown'}

        Provide copy-pasteable shell commands if applicable.`;

    const text = await dashboardRepository.generateAiText(prompt);
    if (text === undefined) {
      return { forbidden: false, blueprint: '### AI Blueprint (Mock)\n1. Update dependency to latest version.\n2. Run `npm install`.\n3. Commit and push.' };
    }

    return { forbidden: false, blueprint: text || 'Failed to generate blueprint' };
  },

  async syncTaskToGithub(taskId: string, userId: string): Promise<{ forbidden: true } | { configError: true } | { ok: true; url: string }> {
    const task = await dashboardRepository.getFinding(taskId);
    const ownerRepo = task.repo_id ? await dashboardRepository.getRepository(task.repo_id) : null;
    if (!ownerRepo || !(await canAccessResource(ownerRepo, userId))) {
      return { forbidden: true };
    }

    if (!process.env.GITHUB_TOKEN) {
      return { configError: true };
    }

    const repoName = task.repo_name || task.repositoryName || '';
    let owner = 'owner';
    let repo = 'repo';
    if (repoName.includes('/')) {
      [owner, repo] = repoName.split('/');
    } else {
      repo = repoName;
    }

    const title = `[Security Action] ${task.title || task.name || 'Vulnerability'}`;
    const body = `**Severity**: ${task.severity}\n**Type**: ${task.type}\n**File**: ${task.file_path || task.filePath || 'Unknown'}\n\nPlease remediate this issue. Automatically generated by Scorpion.`;

    const url = await dashboardRepository.createGithubIssue(owner, repo, title, body);
    await dashboardRepository.setFindingGithubIssueUrl(taskId, url);

    return { ok: true, url };
  },

  async getMetrics(userId: string): Promise<DashboardMetrics> {
    const reposResponse = await dashboardRepository.listUserRepos(userId);
    const repoIds = reposResponse.documents.map(r => r.$id);

    if (repoIds.length === 0) {
      return { noiseReductionPercentage: 0, complianceMapping: {}, averageMTTRMinutes: 0 };
    }

    const findingsResponse = await dashboardRepository.listFindingsForReposScoped(repoIds);
    const findings = findingsResponse.documents;

    const complianceMapping: Record<string, number> = {};
    const resolutionDurationsMs: number[] = [];
    let resolved = 0;

    for (const f of findings) {
      const isResolved = f.status === 'resolved' || f.status === 'remediated';
      if (isResolved) {
        resolved++;
        const created = new Date(f.$createdAt).getTime();
        const closed = new Date(f.$updatedAt).getTime();
        if (closed > created) resolutionDurationsMs.push(closed - created);
        continue;
      }
      const tool = (f.tool || '').toLowerCase();
      let key = 'general';
      if (tool.includes('gitleaks') || tool.includes('secret')) key = 'secret';
      else if (tool.includes('semgrep') || tool.includes('sast')) key = 'sast';
      else if (tool.includes('trivy')) key = 'dependency';
      else if (tool.includes('checkov')) key = 'iac';
      complianceMapping[key] = (complianceMapping[key] || 0) + 1;
    }

    const noiseReductionPercentage = findings.length > 0
      ? Math.round((resolved / findings.length) * 1000) / 10
      : 0;

    const averageMTTRMinutes = resolutionDurationsMs.length > 0
      ? Math.round(resolutionDurationsMs.reduce((s, ms) => s + ms, 0) / resolutionDurationsMs.length / 60000)
      : 0;

    return { noiseReductionPercentage, complianceMapping, averageMTTRMinutes };
  }
};
