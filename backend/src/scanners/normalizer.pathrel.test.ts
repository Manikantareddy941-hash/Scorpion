import { normalizeSemgrep } from './normalizer';

/**
 * Regression cover for the absolute-path bug. Semgrep is handed the absolute
 * temp-clone directory as its target, so it emits absolute paths like
 * C:\...\tmp\repo_<id>\docker-compose.yml. Stored verbatim, findings showed
 * that machine- and scan-specific path in the UI, and the same file scanned
 * twice produced two different `file` values. The stored `file` must be
 * repo-relative and forward-slashed.
 */
describe('normalizeSemgrep file path', () => {
  const workDir = 'C:\\Users\\dev\\tmp\\repo_abc123';

  it('strips the workDir prefix from an absolute path', () => {
    const raw = {
      results: [{
        path: `${workDir}\\src\\routes\\login.ts`,
        check_id: 'javascript.express.security.audit.xss',
        start: { line: 12 },
        end: { line: 12 },
        extra: { severity: 'ERROR', message: 'XSS' },
      }],
    };

    const [finding] = normalizeSemgrep(raw as never, workDir);

    expect(finding.file).toBe('src/routes/login.ts');
  });

  it('leaves an already-relative path alone (only normalising separators)', () => {
    const raw = {
      results: [{
        path: 'docker-compose.yml',
        check_id: 'yaml.docker.security',
        start: { line: 1 },
        end: { line: 1 },
        extra: { severity: 'WARNING', message: 'x' },
      }],
    };

    const [finding] = normalizeSemgrep(raw as never, workDir);

    expect(finding.file).toBe('docker-compose.yml');
  });
});
