import { z } from 'zod';

// GitHub payloads are large and vary by event; schemas only constrain the
// fields this service actually reads, and allow unknown extra fields through
// (GitHub/GitLab send far more than we use, and stripping them is pointless
// since nothing downstream reads req.body directly after validation).

const githubCommitAuthor = z.object({
  name: z.string().optional(),
  username: z.string().optional()
}).partial().passthrough();

const githubCommit = z.object({
  id: z.string().optional(),
  message: z.string().optional(),
  url: z.string().optional(),
  timestamp: z.string().optional(),
  author: githubCommitAuthor.optional(),
  added: z.array(z.string()).optional(),
  modified: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional()
}).passthrough();

export const githubWebhookSchema = z.object({
  repository: z.object({
    html_url: z.string().optional(),
    name: z.string().optional()
  }).passthrough().optional(),
  workflow_run: z.object({
    conclusion: z.string().optional(),
    status: z.string().optional(),
    name: z.string().optional(),
    run_number: z.union([z.string(), z.number()]).optional(),
    html_url: z.string().optional(),
    updated_at: z.string().optional(),
    created_at: z.string().optional()
  }).passthrough().optional(),
  ref: z.string().optional(),
  head_commit: githubCommit.optional(),
  commits: z.array(githubCommit).optional(),
  pull_request: z.object({
    head: z.object({ ref: z.string().optional(), sha: z.string().optional() }).passthrough().optional(),
    title: z.string().optional(),
    user: z.object({ login: z.string().optional() }).passthrough().optional()
  }).passthrough().optional()
}).passthrough();

export const githubAppInstallSchema = z.object({
  installation: z.object({ id: z.union([z.string(), z.number()]) }).passthrough(),
  sender: z.object({ id: z.union([z.string(), z.number()]) }).passthrough(),
  repositories: z.array(z.object({
    html_url: z.string().optional(),
    full_name: z.string(),
    name: z.string().optional()
  }).passthrough()).optional()
}).passthrough();

export const gitlabWebhookSchema = z.object({
  project: z.object({ web_url: z.string().optional() }).passthrough().optional(),
  repository: z.object({ homepage: z.string().optional() }).passthrough().optional(),
  ref: z.string().optional(),
  checkout_sha: z.string().optional(),
  user_name: z.string().optional(),
  commits: z.array(z.object({
    message: z.string().optional(),
    author: z.object({ name: z.string().optional() }).passthrough().optional()
  }).passthrough()).optional(),
  object_attributes: z.object({
    source_branch: z.string().optional(),
    title: z.string().optional(),
    last_commit: z.object({
      id: z.string().optional(),
      author: z.object({ name: z.string().optional() }).passthrough().optional()
    }).passthrough().optional()
  }).passthrough().optional()
}).passthrough();

export const testReportSchema = z.object({
  repo_url: z.string().min(1, 'Missing repo_url'),
  build_id: z.union([z.string(), z.number()]).optional(),
  total_tests: z.union([z.string(), z.number()]).optional(),
  passed_tests: z.union([z.string(), z.number()]).optional(),
  failed_tests: z.union([z.string(), z.number()]).optional(),
  skipped_tests: z.union([z.string(), z.number()]).optional(),
  coverage: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional()
}).passthrough();

export type GithubWebhookPayload = z.infer<typeof githubWebhookSchema>;
export type GithubAppInstallPayload = z.infer<typeof githubAppInstallSchema>;
export type GitlabWebhookPayload = z.infer<typeof gitlabWebhookSchema>;
export type TestReportPayload = z.infer<typeof testReportSchema>;
