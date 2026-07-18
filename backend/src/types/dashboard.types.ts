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
  mttr_days: number | null;
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
