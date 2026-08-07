/**
 * Scanner output parsers: real-shaped JSON in, normalized findings out, and
 * malformed output always degrades to [] instead of crashing ingestion.
 */
jest.mock('../logger', () => ({
    // Spread rather than replace: this module also exports errorContext,
    // and a factory that returns only `logger` makes it undefined at runtime.
    ...jest.requireActual('../logger'),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  parseSemgrep, parseGitleaks, parseTrivy, parseCheckov, parseBandit, parseHadolint,
} from './parsers';

describe('parseSemgrep', () => {
  it('maps results with severity translation', () => {
    const out = parseSemgrep(JSON.stringify({
      results: [
        { check_id: 'js.eval', path: 'a.js', start: { line: 3 }, extra: { severity: 'ERROR', message: 'eval bad' } },
        { check_id: 'js.info', path: 'b.js', start: { line: 1 }, extra: { severity: 'WARNING' } },
        { check_id: 'js.crit', path: 'c.js', extra: { severity: 'CRITICAL', message: 'rce' } },
        { check_id: 'js.unknown', path: 'd.js', extra: {} },
      ],
    }));

    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ tool: 'semgrep', severity: 'high', message: 'eval bad', file_path: 'a.js', line_number: 3 });
    expect(out[1]).toMatchObject({ severity: 'medium', message: 'js.info' }); // falls back to check_id
    expect(out[2].severity).toBe('critical');
    expect(out[3].severity).toBe('info');
  });

  it('returns [] on malformed output', () => {
    expect(parseSemgrep('not json')).toEqual([]);
  });
});

describe('parseGitleaks', () => {
  it('flags every leak as critical without persisting the secret value', () => {
    const out = parseGitleaks(JSON.stringify([
      { Description: 'AWS key', RuleID: 'aws-access-key', File: '.env', StartLine: 2, Secret: 'AKIA...' },
    ]));

    expect(out[0]).toMatchObject({ tool: 'gitleaks', severity: 'critical', file_path: '.env', line_number: 2 });
    expect(out[0].message).toContain('aws-access-key');
    expect(out[0].message).not.toContain('AKIA');
  });

  it('treats empty and null output as no findings', () => {
    expect(parseGitleaks('')).toEqual([]);
    expect(parseGitleaks('  null  ')).toEqual([]);
    expect(parseGitleaks('garbage')).toEqual([]);
  });
});

describe('parseTrivy', () => {
  it('parses vulnerabilities, misconfigurations and secrets from one report', () => {
    const out = parseTrivy(JSON.stringify({
      Results: [
        {
          Target: 'package-lock.json',
          Vulnerabilities: [
            { PkgName: 'lodash', Title: 'proto pollution', Severity: 'HIGH', InstalledVersion: '4.17.20', FixedVersion: '4.17.21', CVSS: { nvd: { V3Score: 7.4 } } },
            { PkgName: 'left-pad', Description: 'sad', Severity: 'LOW' },
          ],
        },
        {
          Target: 'main.tf',
          Misconfigurations: [
            { ID: 'AVD-1', Title: 'open SG', Severity: 'CRITICAL', CauseMetadata: { StartLine: 12 } },
          ],
        },
        {
          Target: 'config.py',
          Secrets: [{ Title: 'Slack token', Severity: 'HIGH', StartLine: 4, Match: 'xoxb-123' }],
        },
      ],
    }));

    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ severity: 'high', package: 'lodash', fixVersion: '4.17.21', cvss_score: 7.4 });
    expect(out[0].message).toContain('Fix available in 4.17.21');
    expect(out[1].message).toContain('No fix available');
    expect(out[2]).toMatchObject({ severity: 'critical', line_number: 12 });
    expect(out[3].message).not.toContain('xoxb'); // secret value never persisted
  });

  it('returns [] on malformed output', () => {
    expect(parseTrivy('{broken')).toEqual([]);
  });
});

describe('parseCheckov', () => {
  it('parses failed checks from single- and multi-framework output', () => {
    const single = parseCheckov(JSON.stringify({
      results: { failed_checks: [{ check_id: 'CKV_1', check_name: 'S3 open', severity: 'HIGH', file_path: 'main.tf', file_line_range: [4, 9] }] },
    }));
    expect(single[0]).toMatchObject({ tool: 'checkov', severity: 'high', line_number: 4 });

    const multi = parseCheckov(JSON.stringify([
      { results: { failed_checks: [{ check_id: 'CKV_2', check_name: 'x', check_severity: 'LOW' }] } },
      { results: {} },
    ]));
    expect(multi).toHaveLength(1);
    expect(multi[0].severity).toBe('low');
  });

  it('defaults unknown severities to medium and survives garbage', () => {
    const out = parseCheckov(JSON.stringify({ results: { failed_checks: [{ check_id: 'CKV_3', check_name: 'y' }] } }));
    expect(out[0].severity).toBe('medium');
    expect(parseCheckov('][')).toEqual([]);
  });
});

describe('parseBandit', () => {
  it('maps python SAST issues', () => {
    const out = parseBandit(JSON.stringify({
      results: [
        { test_id: 'B602', issue_text: 'shell=True', issue_severity: 'HIGH', filename: 'run.py', line_number: 10 },
        { test_id: 'B101', issue_text: 'assert used', issue_severity: 'WEIRD', filename: 'a.py', line_number: 1 },
      ],
    }));
    expect(out[0]).toMatchObject({ tool: 'bandit', severity: 'high', file_path: 'run.py', line_number: 10 });
    expect(out[1].severity).toBe('info');
    expect(parseBandit('nope')).toEqual([]);
  });
});

describe('parseHadolint', () => {
  it('maps dockerfile lint levels', () => {
    const out = parseHadolint(JSON.stringify([
      { code: 'DL3008', message: 'pin versions', level: 'error', file: 'Dockerfile', line: 5 },
      { code: 'DL3059', message: 'consolidate', level: 'style', file: 'Dockerfile', line: 9 },
    ]));
    expect(out[0]).toMatchObject({ severity: 'high', line_number: 5 });
    expect(out[1].severity).toBe('info');
  });

  it('handles empty and non-array output', () => {
    expect(parseHadolint('')).toEqual([]);
    expect(parseHadolint('{}')).toEqual([]);
    expect(parseHadolint('!!')).toEqual([]);
  });
});
