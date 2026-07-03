import dns from 'dns';
import { assertSafeScanTarget, assertSafeWebhookUrl } from './ssrfGuard';

jest.mock('dns', () => ({
    promises: { lookup: jest.fn() },
}));

const mockLookup = dns.promises.lookup as jest.Mock;

describe('assertSafeScanTarget', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        jest.resetAllMocks();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.DAST_ALLOW_PRIVATE_TARGETS;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it('blocks cloud metadata IP literal (169.254.169.254)', async () => {
        await expect(assertSafeScanTarget('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/not allowed/);
    });

    it('blocks loopback and RFC1918 IP literals', async () => {
        await expect(assertSafeScanTarget('http://127.0.0.1/')).rejects.toThrow(/not allowed/);
        await expect(assertSafeScanTarget('http://10.0.0.5/')).rejects.toThrow(/not allowed/);
        await expect(assertSafeScanTarget('http://192.168.1.1/')).rejects.toThrow(/not allowed/);
    });

    it('blocks hostnames that resolve to a private address', async () => {
        mockLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
        await expect(assertSafeScanTarget('http://internal.corp.example/')).rejects.toThrow(/disallowed/);
    });

    it('blocks localhost by name', async () => {
        await expect(assertSafeScanTarget('http://localhost:8080/')).rejects.toThrow(/not allowed/);
    });

    it('rejects non-http(s) schemes', async () => {
        await expect(assertSafeScanTarget('file:///etc/passwd')).rejects.toThrow(/http or https/);
    });

    it('allows a public target that resolves to a public IP', async () => {
        mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
        await expect(assertSafeScanTarget('https://example.com/')).resolves.toBeUndefined();
    });

    it('allows a public IP literal target', async () => {
        await expect(assertSafeScanTarget('http://8.8.8.8/')).resolves.toBeUndefined();
    });

    it('honors DAST_ALLOW_PRIVATE_TARGETS escape hatch', async () => {
        process.env.DAST_ALLOW_PRIVATE_TARGETS = 'true';
        await expect(assertSafeScanTarget('http://169.254.169.254/')).resolves.toBeUndefined();
    });
});

describe('assertSafeWebhookUrl (regression)', () => {
    beforeEach(() => jest.resetAllMocks());

    it('still requires https and blocks private targets', async () => {
        await expect(assertSafeWebhookUrl('http://example.com/hook')).rejects.toThrow(/https/);
        await expect(assertSafeWebhookUrl('https://127.0.0.1/hook')).rejects.toThrow(/not allowed/);
    });
});
