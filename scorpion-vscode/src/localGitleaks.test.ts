import { spawnSync } from 'child_process';
import {
    isGitleaksAvailable,
    scanFileForSecrets,
    __resetAvailabilityCacheForTests,
} from './localGitleaks';

jest.mock('child_process', () => ({
    spawnSync: jest.fn(),
}));

describe('localGitleaks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __resetAvailabilityCacheForTests();
    });

    it('isGitleaksAvailable returns false when the binary is missing', () => {
        (spawnSync as jest.Mock).mockReturnValue({ status: 1 });
        expect(isGitleaksAvailable()).toBe(false);
    });

    it('isGitleaksAvailable returns true when `gitleaks version` exits 0', () => {
        (spawnSync as jest.Mock).mockReturnValue({ status: 0 });
        expect(isGitleaksAvailable()).toBe(true);
    });

    it('isGitleaksAvailable fails closed (false) if spawnSync throws', () => {
        (spawnSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
        expect(isGitleaksAvailable()).toBe(false);
    });

    it('scanFileForSecrets returns [] without calling gitleaks when it is unavailable', () => {
        (spawnSync as jest.Mock).mockReturnValueOnce({ status: 1 }); // availability check

        const findings = scanFileForSecrets('/some/file.ts');

        expect(findings).toEqual([]);
        expect(spawnSync).toHaveBeenCalledTimes(1); // only the availability check, not detect
    });

    it('scanFileForSecrets maps gitleaks JSON matches to Finding objects', () => {
        (spawnSync as jest.Mock)
            .mockReturnValueOnce({ status: 0 }) // availability check
            .mockReturnValueOnce({
                status: 1,
                stdout: JSON.stringify([
                    { RuleID: 'aws-access-key', Description: 'AWS Access Key', StartLine: 12, Match: 'AKIA...' },
                ]),
            });

        const findings = scanFileForSecrets('/some/file.ts');

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            type: 'secret',
            severity: 'CRITICAL',
            file: '/some/file.ts',
            line: 12,
        });
    });

    it('scanFileForSecrets returns [] when gitleaks finds nothing', () => {
        (spawnSync as jest.Mock)
            .mockReturnValueOnce({ status: 0 })
            .mockReturnValueOnce({ status: 0, stdout: '' });

        expect(scanFileForSecrets('/some/file.ts')).toEqual([]);
    });

    it('scanFileForSecrets fails open (returns []) if gitleaks output is unparseable', () => {
        (spawnSync as jest.Mock)
            .mockReturnValueOnce({ status: 0 })
            .mockReturnValueOnce({ status: 0, stdout: 'not json' });

        expect(scanFileForSecrets('/some/file.ts')).toEqual([]);
    });
});
