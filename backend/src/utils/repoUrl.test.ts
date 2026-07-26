import { canonicalizeRepoUrl } from './repoUrl';

describe('canonicalizeRepoUrl', () => {
  const canonical = 'github.com/org/repo';

  it('maps every common URL variant to the same canonical key', () => {
    expect(canonicalizeRepoUrl('https://github.com/org/repo.git')).toBe(canonical);
    expect(canonicalizeRepoUrl('https://github.com/org/repo/')).toBe(canonical);
    expect(canonicalizeRepoUrl('https://github.com/ORG/repo')).toBe(canonical);
    expect(canonicalizeRepoUrl('http://github.com/org/repo')).toBe(canonical);
    expect(canonicalizeRepoUrl('git@github.com:org/repo.git')).toBe(canonical);
    expect(canonicalizeRepoUrl('https://www.github.com/org/repo')).toBe(canonical);
    expect(canonicalizeRepoUrl('https://github.com/org/repo')).toBe(canonical);
  });

  it('is idempotent — canonicalizing a canonical value is a no-op', () => {
    expect(canonicalizeRepoUrl(canonical)).toBe(canonical);
  });

  it('preserves distinct repos (does not over-collapse)', () => {
    expect(canonicalizeRepoUrl('https://github.com/org/repo-two')).not.toBe(canonical);
    expect(canonicalizeRepoUrl('https://gitlab.com/org/repo')).not.toBe(canonical);
    expect(canonicalizeRepoUrl('https://github.com/other/repo')).not.toBe(canonical);
  });

  it('handles empty / whitespace input safely', () => {
    expect(canonicalizeRepoUrl('')).toBe('');
    expect(canonicalizeRepoUrl('   ')).toBe('');
    expect(canonicalizeRepoUrl(undefined as unknown as string)).toBe('');
  });
});
