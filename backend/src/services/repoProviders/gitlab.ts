import { RepoProvider, Repo, StatusParams } from './types';
import axios from 'axios';

export const GitLabProvider: RepoProvider = {
  name: 'gitlab',

  async listRepos(token: string): Promise<Repo[]> {
    const res = await axios.get('https://gitlab.com/api/v4/projects?membership=true&per_page=50', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = res.data;
    if (!Array.isArray(data)) return [];
    
    return data.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      fullName: r.path_with_namespace,
      cloneUrl: r.http_url_to_repo,
      defaultBranch: r.default_branch ?? 'main',
      provider: 'gitlab'
    }));
  },

  cloneUrl(repo: Repo, token: string): string {
    return repo.cloneUrl.replace('https://', `https://oauth2:${token}@`);
  },

  async setStatus({ repo, sha, state, description, token }: StatusParams) {
    const stateMap: Record<string, string> = { pending: 'pending', success: 'success', failure: 'failed' };
    await axios.post(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo.fullName)}/statuses/${sha}`,
      { state: stateMap[state], name: 'scorpion/security-gate', description },
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      }
    );
  }
};
