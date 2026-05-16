import { RepoProvider, Repo, StatusParams } from './types';
import axios from 'axios';

export const AzureProvider: RepoProvider = {
  name: 'azure',

  async listRepos(token: string): Promise<Repo[]> {
    const org = process.env.AZURE_ORG;
    const res = await axios.get(
      `https://dev.azure.com/${org}/_apis/git/repositories?api-version=7.0`,
      { headers: { 'Authorization': `Basic ${Buffer.from(`:${token}`).toString('base64')}` } }
    );
    const data = res.data;
    return (data.value ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      fullName: `${org}/${r.project.name}/${r.name}`,
      cloneUrl: r.remoteUrl,
      defaultBranch: r.defaultBranch?.replace('refs/heads/', '') ?? 'main',
      provider: 'azure'
    }));
  },

  cloneUrl(repo: Repo, token: string): string {
    return repo.cloneUrl.replace('https://', `https://:${token}@`);
  }
};
