jest.mock('../lib/appwrite', () => ({
  databases: {}, DB_ID: 'db', COLLECTIONS: { VULNERABILITIES: 'vulnerabilities' }, Query: {}, ID: {},
}));
jest.mock('./logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('./logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { toStoredFinding } from './scanService';
import { deduplicateFindings } from '../deduplication';

/**
 * Regression cover for the defect that stopped every finding being stored
 * between 2026-05-14 and this fix.
 *
 * The ingest spread a scanner's own object into the create payload. The
 * normalizer emits `file`, `line`, `reachability` and `fixAvailable`; the
 * collection defines `file_path` and `line_number` and has no column for the
 * other two. Appwrite rejects the whole document when it carries an unknown
 * attribute, so every write failed — and the error was logged without its
 * reason, so nothing surfaced.
 */
describe('toStoredFinding', () => {
  const normalizerOutput = {
    tool: 'trivy',
    type: 'security',
    severity: 'HIGH',
    title: 'CVE-2019-10744 lodash',
    message: 'Prototype pollution in lodash < 4.17.12',
    file: 'package.json',
    line: 21,
    endLine: 21,
    code: '"lodash": "4.17.4"',
    effort: '5min',
    category: 'vulnerable-dependency',
    ruleId: 'CVE-2019-10744',
    reachability: 'reachable',
    fixAvailable: true,
  };

  it('translates the normalizer field names to the collection columns', () => {
    const stored = toStoredFinding(normalizerOutput, 'repo-1', 'scan-1');

    expect(stored.file_path).toBe('package.json');
    expect(stored.line_number).toBe(21);
    expect(stored).not.toHaveProperty('file');
    expect(stored).not.toHaveProperty('line');
  });

  it('drops keys the collection has no column for', () => {
    // The specific pair that broke ingestion. gateService reads both from the
    // in-memory finding before storage, never back out of the database.
    const stored = toStoredFinding(normalizerOutput, 'repo-1', 'scan-1');

    expect(stored).not.toHaveProperty('reachability');
    expect(stored).not.toHaveProperty('fixAvailable');
  });

  it('emits only keys the collection defines', () => {
    // The real invariant: whatever a scanner adds in future, the payload must
    // never carry a key Appwrite will reject.
    const columns = new Set([
      'repo_id', 'scan_result_id', 'tool', 'severity', 'message', 'file_path',
      'line_number', 'status', 'resolution_status', 'fingerprint', 'scanId',
      'package', 'version', 'fixVersion', 'pr_url', 'detected_at', 'cvss_score',
      'verified', 'type', 'endLine', 'code', 'effort', 'category', 'ruleId',
      'runId', 'source', 'title', 'reopenCount', 'resolvedAt', 'epss_score',
      'epss_percentile', 'kev', 'risk_score',
    ]);

    const stored = toStoredFinding(
      { ...normalizerOutput, somethingAScannerAddedLater: 'x' },
      'repo-1',
      'scan-1',
    );

    for (const key of Object.keys(stored)) {
      expect(columns.has(key)).toBe(true);
    }
  });

  it('handles the IngestableIssue vocabulary too', () => {
    const stored = toStoredFinding(
      { filePath: 'app.js', cveId: 'CVE-2018-1002204', severity: 'CRITICAL' },
      'repo-1',
      'scan-1',
    );

    expect(stored.file_path).toBe('app.js');
    expect(stored).not.toHaveProperty('filePath');
    // cve_id is not a column on this collection, so it must be dropped rather
    // than passed through and rejected.
    expect(stored).not.toHaveProperty('cveId');
  });

  it('survives the deduplication pass in front of it', () => {
    // The real triggerScan path is normalizer -> deduplicateFindings ->
    // toStoredFinding. The deduplicator used to rebuild each finding as a
    // minimal object, discarding `tool` and `message` (both required columns)
    // and reading filePath from names the normalizer never emits — so every
    // finding reached persistence missing required attributes, and its empty
    // filePath collapsed all findings into one dedup group, merging by ruleId
    // ACROSS files. The first full-pipeline run failed on exactly this.
    const second = { ...normalizerOutput, file: 'routes/index.js', line: 7, ruleId: 'CVE-2017-16042', title: 'growl RCE', message: 'command injection in growl' };
    const deduped = deduplicateFindings([normalizerOutput, second]);

    // Different files, different rules: nothing may merge.
    expect(deduped).toHaveLength(2);

    for (const d of deduped) {
      const stored = toStoredFinding(d, 'repo-1', 'scan-1');
      expect(stored.tool).toBe('trivy');
      expect(typeof stored.message).toBe('string');
      expect(String(stored.message).length).toBeGreaterThan(0);
      expect(String(stored.file_path).length).toBeGreaterThan(0);
      // Dedup bookkeeping must not leak into the payload.
      expect(stored).not.toHaveProperty('hash');
      expect(stored).not.toHaveProperty('sources');
      expect(stored).not.toHaveProperty('scanner');
    }
  });

  it('stamps the wrapper fields and caps code length', () => {
    const stored = toStoredFinding({ code: 'x'.repeat(6000) }, 'repo-9', 'scan-9');

    expect(stored.repo_id).toBe('repo-9');
    expect(stored.scanId).toBe('scan-9');
    expect(stored.status).toBe('open');
    expect(String(stored.code)).toHaveLength(4999);
  });
});
