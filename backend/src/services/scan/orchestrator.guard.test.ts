jest.mock('../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../runner', () => ({ getRunner: jest.fn() }));
jest.mock('../../utils/toolCheck', () => ({ validateTools: jest.fn() }));

import { ScanResult, ScannerUnavailableError, assertScannersUsable } from './orchestrator';

const ok = (tool: ScanResult['tool'], stdout = '{}'): ScanResult => ({ tool, stdout, stderr: '', status: 0 });
const dead = (tool: ScanResult['tool'], error: string): ScanResult => ({
    tool, stdout: '', stderr: error, error, status: null, unavailable: true,
});

describe('assertScannersUsable', () => {
    test('passes when every scanner produced a verdict', () => {
        expect(() => assertScannersUsable([ok('trivy'), ok('semgrep'), ok('gitleaks')])).not.toThrow();
    });

    test('throws when a scanner never ran', () => {
        // The whole point: an empty result from a scanner that never executed is
        // indistinguishable from a clean scan once the flag is dropped.
        expect(() => assertScannersUsable([ok('trivy'), dead('semgrep', 'spawn ENOENT')]))
            .toThrow(ScannerUnavailableError);
    });

    test('names the scanner and the reason, so the operator can fix it', () => {
        // A bare "scan failed" sends someone digging through logs for the one
        // line that says which engine was missing.
        expect(() => assertScannersUsable([dead('semgrep', 'spawn ENOENT')]))
            .toThrow(/semgrep.*spawn ENOENT/);
    });

    test('reports every unavailable scanner, not just the first', () => {
        // Fixing them one restart at a time is how a five-minute problem
        // becomes an afternoon.
        const err = (() => {
            try { assertScannersUsable([dead('semgrep', 'no binary'), ok('trivy'), dead('bandit', 'no binary')]); }
            catch (e) { return e as ScannerUnavailableError; }
        })();

        expect(err).toBeInstanceOf(ScannerUnavailableError);
        expect(err!.tools).toEqual(['semgrep', 'bandit']);
    });

    test('an empty result set is not a pass', () => {
        // Nothing ran at all. Reporting that as clean is the same lie in its
        // purest form, and `[].every(...)` is true — so it needs its own guard.
        expect(() => assertScannersUsable([])).toThrow(ScannerUnavailableError);
    });

    test('only the named scanners are required when a caller restricts the set', () => {
        // pipeline.ts reports on three tools; a checkov failure cannot corrupt a
        // verdict computed from trivy, semgrep and gitleaks, so failing the run
        // on it would be a false alarm.
        expect(() => assertScannersUsable(
            [ok('trivy'), ok('semgrep'), ok('gitleaks'), dead('checkov', 'no binary')],
            ['trivy', 'semgrep', 'gitleaks'],
        )).not.toThrow();
    });

    test('a restricted scanner that failed still throws', () => {
        expect(() => assertScannersUsable(
            [dead('trivy', 'no binary'), ok('semgrep'), ok('gitleaks')],
            ['trivy', 'semgrep', 'gitleaks'],
        )).toThrow(/trivy/);
    });

    test('a required scanner absent from the results is not treated as clean', () => {
        // Distinct from `unavailable`: the tool produced no record at all. The
        // caller asked for a verdict on it and is about to report zero findings.
        expect(() => assertScannersUsable([ok('semgrep'), ok('gitleaks')], ['trivy', 'semgrep', 'gitleaks']))
            .toThrow(/trivy/);
    });
});
