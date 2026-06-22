import { webhookRepository } from '../repositories/webhookRepository';
import { enqueueScan } from '../queues/scanQueue';
import { triggerPipelineRun } from '../services/pipelineService';
import { logger } from './logger';
import { GithubAppInstallPayload, GithubWebhookPayload, GitlabWebhookPayload, TestReportPayload } from '../types/webhook.types';

export const webhookIngestService = {
  /**
   * GitHub `workflow_run` event: logs the build and, on success, enqueues a scan.
   */
  async processGithubWorkflowRun(payload: GithubWebhookPayload): Promise<{ status: 'no_payload' | 'missing_repo_url' | 'no_match' } | { status: 'ok'; message: string }> {
    const workflowRun = payload.workflow_run;
    if (!workflowRun) return { status: 'no_payload' };

    const repoUrl = payload.repository?.html_url;
    if (!repoUrl) return { status: 'missing_repo_url' };

    const repos = await webhookRepository.findReposByUrl(repoUrl);
    if (repos.total === 0) return { status: 'no_match' };

    const status = workflowRun.conclusion || workflowRun.status || 'in_progress';

    for (const repo of repos.documents) {
      try {
        await webhookRepository.createBuildLog({
          repo_id: repo.$id,
          repo_name: payload.repository?.name || 'Unknown',
          workflow_name: workflowRun.name || 'CI',
          status,
          run_number: String(workflowRun.run_number || '1'),
          run_url: workflowRun.html_url || '',
          timestamp: workflowRun.updated_at || workflowRun.created_at || new Date().toISOString()
        });
      } catch (err) {
        logger.error('[Webhook] Failed to log build:', err);
      }

      if (status === 'success') {
        enqueueScan(repo.$id, {}).catch(err => {
          logger.error(`[Webhook] Failed to enqueue scan for ${repo.$id}:`, err);
        });
      }
    }

    return { status: 'ok', message: `Logged workflow_run and handled triggers for ${repos.total} repository(ies)` };
  },

  /**
   * GitHub `push` / `pull_request` events: logs commits (push only) and triggers pipeline runs.
   */
  async processGithubPushOrPullRequest(event: 'push' | 'pull_request', payload: GithubWebhookPayload): Promise<{ status: 'missing_repo_url' } | { status: 'no_match' } | { status: 'ok'; runs: string[] }> {
    const repoUrl = payload.repository?.html_url;
    if (!repoUrl) return { status: 'missing_repo_url' };

    const repos = await webhookRepository.findReposByUrl(repoUrl);
    if (repos.total === 0) return { status: 'no_match' };

    const branch = event === 'push'
      ? (payload.ref?.replace('refs/heads/', '') || 'main')
      : (payload.pull_request?.head?.ref || 'main');

    const commitHash = event === 'push'
      ? (payload.head_commit?.id || 'HEAD')
      : (payload.pull_request?.head?.sha || 'HEAD');

    const commitMessage = event === 'push'
      ? (payload.head_commit?.message || 'Push event trigger')
      : (payload.pull_request?.title || 'Pull request event trigger');

    const author = event === 'push'
      ? (payload.head_commit?.author?.name || payload.head_commit?.author?.username || 'Unknown')
      : (payload.pull_request?.user?.login || 'Unknown');

    // Log the commits first (reusing existing schema)
    if (event === 'push') {
      const commits = payload.commits || [];
      const sensitivePatterns = ['.env', 'password', 'secret', 'key.pem', 'credentials', 'config.json', 'token'];
      for (const repo of repos.documents) {
        for (const commit of commits) {
          const filesChanged = [
            ...(commit.added || []),
            ...(commit.modified || []),
            ...(commit.removed || [])
          ];
          const isSensitive = filesChanged.some(file =>
            sensitivePatterns.some(pattern => file.toLowerCase().includes(pattern))
          );
          try {
            await webhookRepository.createCommitLog({
              repo_id: repo.$id,
              commit_hash: commit.id || String(Date.now()),
              author: commit.author?.name || commit.author?.username || 'Unknown',
              message: commit.message || '',
              url: commit.url || '',
              timestamp: commit.timestamp || new Date().toISOString(),
              files_changed: filesChanged.map(String),
              is_sensitive: isSensitive
            });
          } catch (err) {
            logger.error('[Webhook] Failed to log commit:', err);
          }
        }
      }
    }

    const triggeredRuns: string[] = [];
    for (const repo of repos.documents) {
      const runId = await triggerPipelineRun(repo.$id, branch, commitHash, commitMessage, author);
      triggeredRuns.push(runId);
    }

    return { status: 'ok', runs: triggeredRuns };
  },

  /**
   * GitLab `Push Hook` / `Merge Request Hook` events: triggers pipeline runs.
   */
  async processGitlabEvent(event: 'Push Hook' | 'Merge Request Hook', payload: GitlabWebhookPayload): Promise<{ status: 'missing_repo_url' } | { status: 'no_match' } | { status: 'ok'; runs: string[] }> {
    const repoUrl = payload.project?.web_url || payload.repository?.homepage;
    if (!repoUrl) return { status: 'missing_repo_url' };

    const repos = await webhookRepository.findReposByUrl(repoUrl);
    if (repos.total === 0) return { status: 'no_match' };

    const branch = event === 'Push Hook'
      ? (payload.ref?.replace('refs/heads/', '') || 'main')
      : (payload.object_attributes?.source_branch || 'main');

    const commitHash = event === 'Push Hook'
      ? (payload.checkout_sha || 'HEAD')
      : (payload.object_attributes?.last_commit?.id || 'HEAD');

    const commitMessage = event === 'Push Hook'
      ? (payload.commits?.[0]?.message || 'GitLab Push trigger')
      : (payload.object_attributes?.title || 'GitLab Merge Request trigger');

    const author = event === 'Push Hook'
      ? (payload.user_name || payload.commits?.[0]?.author?.name || 'Unknown')
      : (payload.object_attributes?.last_commit?.author?.name || 'Unknown');

    const triggeredRuns: string[] = [];
    for (const repo of repos.documents) {
      const runId = await triggerPipelineRun(repo.$id, branch, commitHash, commitMessage, author);
      triggeredRuns.push(runId);
    }

    return { status: 'ok', runs: triggeredRuns };
  },

  /**
   * GitHub App `installation` / `installation_repositories` events: correlates the
   * installing GitHub user to a SCORPION account and syncs newly granted repos.
   */
  async processGithubAppInstall(payload: GithubAppInstallPayload): Promise<{ status: 'user_not_found' } | { status: 'ok' }> {
    const { installation, repositories, sender } = payload;
    const githubUserId = String(sender.id);
    const installationId = String(installation.id);

    // Find SCORPION user by github_user_id in preferences
    // Since Appwrite doesn't support direct preference querying, we iterate over current users
    const targetUser = await webhookRepository.findUserByGithubId(githubUserId);

    if (!targetUser) {
      logger.warn(`[Webhook] No SCORPION user found for GitHub ID: ${githubUserId}`);
      return { status: 'user_not_found' };
    }

    await webhookRepository.setGithubInstallationId(targetUser.$id, targetUser.prefs, installationId);

    // Automatically register repositories
    if (repositories && repositories.length > 0) {
      for (const repo of repositories) {
        const url = repo.html_url || `https://github.com/${repo.full_name}`;
        const name = repo.name || repo.full_name.split('/').pop();

        const existingRepos = await webhookRepository.findRepoByUserAndUrl(targetUser.$id, url);

        if (existingRepos.total === 0) {
          await webhookRepository.createRepo({
            user_id: targetUser.$id,
            url,
            name,
            visibility: 'public',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      }
    }

    return { status: 'ok' };
  },

  /**
   * CI test report: logs the run and, when all tests passed, enqueues a follow-up scan.
   */
  async processTestReport(payload: TestReportPayload): Promise<{ status: 'no_match' } | { status: 'ok' }> {
    const { repo_url, build_id, total_tests, passed_tests, failed_tests, skipped_tests, coverage, status } = payload;

    const repos = await webhookRepository.findReposByUrl(repo_url);
    if (repos.total === 0) return { status: 'no_match' };

    for (const repo of repos.documents) {
      const hasFailed = Number(failed_tests || 0) > 0 || status === 'failed';

      await webhookRepository.createTestRun({
        repo_id: repo.$id,
        repo_name: repo.name,
        build_id: String(build_id || Date.now()),
        total_tests: Number(total_tests || 0),
        passed_tests: Number(passed_tests || 0),
        failed_tests: Number(failed_tests || 0),
        skipped_tests: Number(skipped_tests || 0),
        coverage: Number(coverage || 0),
        status: hasFailed ? 'failed' : 'passed',
        timestamp: new Date().toISOString()
      });

      if (!hasFailed) {
        enqueueScan(repo.$id, {}).catch(e => logger.error(e));
      } else {
        logger.warn(`[Test Webhook] Skipping scan for ${repo.$id} due to failed tests`);
      }
    }

    return { status: 'ok' };
  }
};
