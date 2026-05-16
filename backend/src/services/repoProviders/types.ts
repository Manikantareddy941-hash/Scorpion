export interface Repo {
  id: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  provider: string;
}

export interface StatusParams {
  repo: Repo;
  sha: string;
  state: 'pending' | 'success' | 'failure';
  description: string;
  token: string;
}

export interface RepoProvider {
  name: 'github' | 'gitlab' | 'bitbucket' | 'azure';
  listRepos(token: string): Promise<Repo[]>;
  cloneUrl(repo: Repo, token: string): string;
  setStatus?(params: StatusParams): Promise<void>;
}
