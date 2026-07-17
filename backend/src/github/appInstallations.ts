import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

/**
 * Org-wide repo discovery: the GitHub App is installed per-org, so instead of
 * asking users to paste repo URLs one-by-one we enumerate every repository the
 * installed App can already see and let the user bulk-connect them.
 */

export interface InstallationRepo {
  installation_id: number;
  account: string;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
}

function appCredentials(): { appId: string; privateKey: string } {
  const appId = process.env.GITHUB_APP_ID || '';
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
  if (!appId || !privateKey) {
    throw new Error('GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)');
  }
  return { appId, privateKey };
}

export async function listInstallationRepos(): Promise<InstallationRepo[]> {
  const { appId, privateKey } = appCredentials();

  const appOctokit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey } });
  const installations = await appOctokit.paginate(appOctokit.apps.listInstallations);

  const repos: InstallationRepo[] = [];
  for (const installation of installations) {
    const installationOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId: installation.id }
    });
    // account is a user/org | enterprise union; enterprise has name, the rest login
    const acct = installation.account as { login?: string; name?: string } | null;
    const account = acct?.login ?? acct?.name ?? 'unknown';

    const accessible = await installationOctokit.paginate(
      installationOctokit.apps.listReposAccessibleToInstallation
    );
    for (const repo of accessible) {
      repos.push({
        installation_id: installation.id,
        account,
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        private: repo.private
      });
    }
  }
  return repos;
}
