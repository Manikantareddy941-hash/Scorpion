/**
 * Canonical match-key for a repository URL.
 *
 * The same repo reaches us as many string variants depending on who emits it —
 * GitHub Actions, GitLab CI, a local CLI, a hand-typed dashboard entry:
 *   https://github.com/org/repo.git
 *   https://github.com/org/repo/
 *   https://github.com/ORG/repo
 *   git@github.com:org/repo.git
 * An exact-string match on any of these silently drops the hand-off (a SARIF
 * ingest 404s, a re-connect creates a duplicate repo). Reducing every variant
 * to one canonical form closes that seam.
 *
 * This is a MATCH KEY, not a stored value — callers compare canonical forms;
 * the original URL is preserved for display. Intentionally conservative: it
 * normalizes transport/suffix/case noise, not the host+path identity itself.
 */
export function canonicalizeRepoUrl(raw: string): string {
  let s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';

  // SSH scp-like syntax: git@host:org/repo(.git) -> host/org/repo
  const scp = s.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme://  (https, http, ssh, git)
  }

  s = s.replace(/^www\./, '');   // host prefix
  s = s.replace(/\/+$/, '');     // trailing slash(es)
  s = s.replace(/\.git$/, '');   // .git suffix

  return s;
}
