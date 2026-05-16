import { RepoProvider, Repo, StatusParams } from './types';
import axios from 'axios';

export const BitbucketProvider: RepoProvider = {
  name: 'bitbucket',

  async listRepos(token: string): Promise<Repo[]> {
    const res = await axios.get('https://api.bitbucket.org/2.0/repositories?role=member&pagelen=50', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = res.data;
    return (data.values ?? []).map((r: any) => ({
      id: r.uuid,
      name: r.name,
      fullName: r.full_name,
      cloneUrl: r.links.clone.find((c: any) => c.name === 'https')?.href ?? '',
      defaultBranch: r.mainbranch?.name ?? 'main',
      provider: 'bitbucket'
    }));
  },

  cloneUrl(repo: Repo, token: string): string {
    return repo.cloneUrl.replace('https://', `https://x-token-auth:${token}@`);
  },

  async setStatus({ repo, sha, state, description, token }: StatusParams) {
    const stateMap: Record<string, string> = { pending: 'INPROGRESS', success: 'SUCCESSFUL', failure: 'FAILED' };
    const [workspace, slug] = repo.fullName.split('/');
    await axios.post(
      `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}/commit/${sha}/statuses/build`,
      {
        state: stateMap[state], key: 'scorpion/security-gate',
        name: 'SCORPION Security Gate', description
      },
      {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      }
    );
  }
};
