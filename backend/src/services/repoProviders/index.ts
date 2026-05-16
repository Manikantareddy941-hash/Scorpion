import { GitLabProvider } from './gitlab';
import { BitbucketProvider } from './bitbucket';
import { AzureProvider } from './azure';
import { RepoProvider } from './types';

const providers: Record<string, RepoProvider> = {
  gitlab: GitLabProvider,
  bitbucket: BitbucketProvider,
  azure: AzureProvider
};

export function getProvider(name: string): RepoProvider {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export * from './types';
