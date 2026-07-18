import { Models } from 'node-appwrite';
import { Request } from 'express';
import { z } from 'zod';

export interface AuthenticatedRequest extends Request<Record<string, string>> {
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

export const bulkConnectSchema = z.object({
  urls: z
    .array(z.string().trim().url('each entry must be a valid URL'))
    .min(1, 'urls must contain at least one repository')
    .max(100, 'at most 100 repositories can be connected per request'),
});

export type AddRepoInput = z.infer<typeof addRepoSchema>;
export type BulkConnectInput = z.infer<typeof bulkConnectSchema>;
export type ExternalScanInput = z.infer<typeof externalScanSchema>;
export type TriggerScanInput = z.infer<typeof triggerScanSchema>;

export interface ScanStatusResponse {
  id: string;
  status: string;
  /** Which repository this scan belongs to — the detail pages use it to link
   *  back, and previously read it off a document fetched straight from the
   *  browser with no ownership check. */
  repo_id: string;
  scan_type: string;
  created_at: string;
  repoUrl: string;
  visibility: string;
  scannerVersion: string;
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
