import { Models } from 'node-appwrite';
import { Request } from 'express';
import { z } from 'zod';

export interface AuthenticatedRequest extends Request {
  user?: Models.User<Models.Preferences>;
}

export const addRepoSchema = z.object({
  url: z.string().trim().url('url must be a valid URL'),
});

export const externalScanSchema = z.object({
  provider: z.string().trim().min(1),
  repoFullName: z.string().trim().min(1),
  cloneUrl: z.string().trim().url('cloneUrl must be a valid URL'),
  branch: z.string().trim().min(1).max(255).optional(),
});

export const triggerScanSchema = z.object({
  scanType: z.enum(['full', 'incremental', 'quick']).optional(),
  scanDepth: z.enum(['standard', 'deep']).optional(),
  branch: z.string().trim().min(1).max(255).optional(),
});

export type AddRepoInput = z.infer<typeof addRepoSchema>;
export type ExternalScanInput = z.infer<typeof externalScanSchema>;
export type TriggerScanInput = z.infer<typeof triggerScanSchema>;

export interface ScanStatusResponse {
  id: string;
  status: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  security_score: number;
  gateStatus: string;
  total_vulnerabilities: number;
  tool_counts: Record<string, number>;
  language: string;
  total_files: number;
  total_lines: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  logs: string[];
}
