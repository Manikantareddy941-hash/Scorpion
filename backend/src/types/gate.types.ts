import { Request } from 'express';
import { z } from 'zod';

export interface AuthenticatedRequest extends Request {
  user?: { $id: string };
}

export const repoIdBodySchema = z.object({
  repo_id: z.string().trim().min(1, 'repo_id is required')
});

export type RepoIdBody = z.infer<typeof repoIdBodySchema>;

export interface GateBlocker {
  $id: string;
  title?: string;
  severity?: string;
  packageName?: string;
  package?: string;
}

export interface GateResult {
  allowed: boolean;
  score: number;
  blocker_count: number;
  blockers: GateBlocker[];
  minSecurityScore: number;
  regoDenyReasons?: string[];
}

export type PipelineGateStatus = 'passing' | 'BLOCKED';
