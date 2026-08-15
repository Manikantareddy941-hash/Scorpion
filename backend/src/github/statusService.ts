import { Octokit } from '@octokit/rest';
import { logger, errorContext } from '../services/logger';

export interface CommitStatusOptions {
  owner: string;
  repo: string;
  sha: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  description: string;
  context: string;
  target_url?: string;
}

export async function setCommitStatus(octokit: Octokit, options: CommitStatusOptions) {
  try {
    await octokit.repos.createCommitStatus({
      owner: options.owner,
      repo: options.repo,
      sha: options.sha,
      state: options.state,
      description: options.description.slice(0, 140), // GitHub 140 char limit
      context: options.context,
      ...(options.target_url && { target_url: options.target_url })
    });
  } catch (error) {
    logger.error(`[GitHub] Error setting commit status for ${options.repo} (${options.sha}):`, {
      event: 'GITHUB_COMMIT_STATUS_FAILED',
      owner: options.owner,
      repo: options.repo,
      sha: options.sha,
      state: options.state,
      context: options.context,
      ...errorContext(error),
    });
  }
}
