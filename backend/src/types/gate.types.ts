import { Request } from 'express';
import { z } from 'zod';

export interface AuthenticatedRequest extends Request<Record<string, string>> {
  user?: { $id: string };
}

export const repoIdBodySchema = z.object({
  repo_id: z.string().trim().min(1, 'repo_id is required')
});

export type RepoIdBody = z.infer<typeof repoIdBodySchema>;

// Compliance-gate CI call: repo plus the commit context to record in the ledger.
export const complianceBodySchema = repoIdBodySchema.extend({
  commit_sha: z.string().trim().max(64).optional(),
  branch: z.string().trim().max(255).optional(),
});

export interface GateBlocker {
  $id: string;
  title?: string;
  severity?: string;
  packageName?: string;
  package?: string;
  /** CVE-specific: whether a fixed version exists. Undefined for non-CVE
   *  findings (secrets, SAST, license, misconfig) - the fix-available filter
   *  only ever drops findings that are explicitly known to have no fix. */
  fixAvailable?: boolean;
}

export interface GateResult {
  allowed: boolean;
  score: number;
  blocker_count: number;
  blockers: GateBlocker[];
  minSecurityScore: number;
  regoDenyReasons?: string[];
}

// 'OVERRIDDEN' = shipped despite a compliance violation via an audited break-
// glass. Distinct from 'passing' (compliant) and 'BLOCKED' (stopped): a release
// that bypassed security is neither. Downstream (checkDeployable, K8s operators,
// audit) can tell exactly what they are looking at.
export type PipelineGateStatus = 'passing' | 'BLOCKED' | 'OVERRIDDEN';
