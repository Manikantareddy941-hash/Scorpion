import { Request } from 'express';
import { Models } from 'node-appwrite';

export interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: { $id: string };
}

export type RepoDocument = Models.Document & {
  name?: string;
  url?: string;
  user_id?: string;
  team_id?: string;
  gate_status?: string;
  security_score?: number;
};

export type ScanDocument = Models.Document & {
  repo_id?: string;
  repoUrl?: string;
};

export type FindingDocument = Models.Document & {
  /** Absent on documents written before risk scoring existed — always coalesce. */
  risk_score?: number;
  repo_id?: string;
  scanId?: string;
  severity?: string;
  type?: string;
  tool?: string;
  title?: string;
  name?: string;
  message?: string;
  file_path?: string;
  filePath?: string;
  repo_name?: string;
  repositoryName?: string;
  status?: string;
};

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface TypeCounts {
  secret: number;
  dependency: number;
  sast: number;
  docker: number;
  iac: number;
}

export interface RepoFindingCount {
  repo_id: string;
  repo_name: string;
  count: number;
  critical: number;
  high: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface SlaSummary {
  /** Open findings already past their severity window. */
  breached: number;
  /** Not yet breached, but inside 24h of the deadline. */
  dueSoon: number;
  /** Subset of `breached` that are critical — the ones that need a name on them. */
  breachedCritical: number;
  /** Hours until the soonest upcoming breach; null when nothing is pending. */
  nextHours: number | null;
}

export interface SecurityDashboardStats {
  total: number;
  by_severity: SeverityCounts;
  by_type: TypeCounts;
  by_type_severity: Record<keyof TypeCounts, SeverityCounts>;
  by_repo: RepoFindingCount[];
  trend: TrendPoint[];
  open_count: number;
  resolved_count: number;
  /** Findings resolved since local midnight. Served here so the dashboard does
   *  not have to query the findings collection directly to compute it. */
  remediated_today: number;
  /** Mean detection-to-resolution days for today's remediations only. Distinct
   *  from mttr_days, which spans all resolved findings — the dashboard shows
   *  today's figure and the two must not be conflated. */
  mttr_today_days: number | null;
  mttr_days: number | null;
  /** SLA posture over the caller's open findings, computed server-side so the
   *  browser never has to pull every finding to work it out. */
  sla: SlaSummary;
  /** Highest-risk of the most recent findings, for the dashboard's "latest"
   *  and "remediation queue" panels. Deliberately small and purpose-built:
   *  `findings` below can carry thousands of documents. */
  recent_findings: FindingDocument[];
  findings?: unknown[];
}

export interface PostureBreakdown {
  score: number;
  breakdown: Array<{ category: string; impact: number; count?: number; rate?: string }>;
  recommendations: string[];
}

export interface DashboardMetrics {
  noiseReductionPercentage: number;
  complianceMapping: Record<string, number>;
  averageMTTRMinutes: number;
}
