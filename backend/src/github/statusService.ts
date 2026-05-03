import { Octokit } from '@octokit/rest';

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
    console.error(`[GitHub] Error setting commit status for ${options.repo} (${options.sha}):`, error);
  }
}
