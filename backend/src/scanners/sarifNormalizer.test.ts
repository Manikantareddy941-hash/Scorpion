import { normalizeSarif } from './sarifNormalizer';

// A minimal SARIF 2.1.0 log with one run/one result. Overrides let each test
// vary just the field under test.
const sarif = (result: Record<string, unknown> = {}, driver: Record<string, unknown> = {}) => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'CodeQL', rules: [], ...driver } },
      results: [
        {
          ruleId: 'js/sql-injection',
          level: 'error',
          message: { text: 'Query built from user-controlled input' },
          locations: [
            { physicalLocation: { artifactLocation: { uri: 'src/db.js' }, region: { startLine: 12, endLine: 14 } } },
          ],
          ...result,
        },
      ],
    },
  ],
});

describe('normalizeSarif', () => {
  it('maps a result into the shared NormalizedIssue shape', () => {
    const [issue] = normalizeSarif(sarif());
    expect(issue.tool).toBe('codeql');
    expect(issue.ruleId).toBe('js/sql-injection');
    expect(issue.message).toBe('Query built from user-controlled input');
    expect(issue.file).toBe('src/db.js');
    expect(issue.line).toBe(12);
    expect(issue.endLine).toBe(14);
  });

  it('derives severity from security-severity when present (CVSS-style band)', () => {
    const band = (score: string) => normalizeSarif(sarif({ properties: { 'security-severity': score } }))[0].severity;
    expect(band('9.8')).toBe('CRITICAL');
    expect(band('7.5')).toBe('HIGH');
    expect(band('5.0')).toBe('MEDIUM');
    expect(band('2.0')).toBe('LOW');
  });

  it('falls back to the SARIF level when there is no security-severity', () => {
    const bylevel = (level: string) => normalizeSarif(sarif({ level }))[0].severity;
    expect(bylevel('error')).toBe('HIGH');
    expect(bylevel('warning')).toBe('MEDIUM');
    expect(bylevel('note')).toBe('LOW');
    expect(bylevel('none')).toBe('INFO');
  });

  it('resolves rule metadata by ruleIndex when the result omits ruleId', () => {
    const log = sarif(
      { ruleId: undefined, ruleIndex: 0 },
      { rules: [{ id: 'py/tainted-sql', name: 'SQL query built from user input' }] },
    );
    const [issue] = normalizeSarif(log);
    expect(issue.ruleId).toBe('py/tainted-sql');
    expect(issue.title).toBe('SQL query built from user input');
  });

  it('infers canonical categories from well-known tools', () => {
    const cat = (driverName: string, ruleId: string, tags: string[] = []) =>
      normalizeSarif(sarif({ ruleId }, { name: driverName, rules: [{ id: ruleId, properties: { tags } }] }))[0].category;
    expect(cat('gitleaks', 'generic-api-key')).toBe('secret-exposure');
    expect(cat('Trivy', 'CVE-2021-44228')).toBe('dependency-vulnerability');
    expect(cat('Checkov', 'CKV_AWS_20')).toBe('iac-misconfig');
    // Secret inferred from tags even when the tool is unknown.
    expect(cat('acme-scanner', 'rule-1', ['security', 'secret'])).toBe('secret-exposure');
  });

  it('keeps the rule id as the category for generic SAST so downstream keyword matching still works', () => {
    const [issue] = normalizeSarif(sarif({ ruleId: 'js/sql-injection' }));
    expect(issue.category).toBe('js/sql-injection');
  });

  it('strips a file:// scheme from the artifact uri', () => {
    const log = sarif({ locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///app/src/db.js' } } }] });
    expect(normalizeSarif(log)[0].file).toBe('/app/src/db.js');
  });

  it('aggregates results across every run', () => {
    const log = sarif();
    log.runs.push({
      tool: { driver: { name: 'Semgrep', rules: [] } },
      results: [{ ruleId: 'r2', level: 'warning', message: { text: 'x' }, locations: [] }],
    });
    expect(normalizeSarif(log)).toHaveLength(2);
  });

  it('returns an empty array for malformed or empty input instead of throwing', () => {
    expect(normalizeSarif(undefined)).toEqual([]);
    expect(normalizeSarif({})).toEqual([]);
    expect(normalizeSarif({ runs: [] })).toEqual([]);
    expect(normalizeSarif({ runs: [{ results: [] }] })).toEqual([]);
  });
});
