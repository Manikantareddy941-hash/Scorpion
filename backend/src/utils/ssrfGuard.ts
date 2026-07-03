import dns from 'dns';
import net from 'net';
import { URL } from 'url';

const isPrivateIp = (ip: string): boolean => {
    if (net.isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        if (parts[0] === 10) return true;                                   // 10.0.0.0/8
        if (parts[0] === 127) return true;                                  // loopback
        if (parts[0] === 0) return true;                                    // 0.0.0.0/8
        if (parts[0] === 169 && parts[1] === 254) return true;              // link-local / cloud metadata
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
        if (parts[0] === 192 && parts[1] === 168) return true;              // 192.168.0.0/16
        return false;
    }
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;                  // loopback
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80')) return true;         // link-local
    return false;
};

/**
 * Throws if rawUrl points at localhost, a private/link-local address, a
 * cloud metadata endpoint, or doesn't use https. Use before the server
 * makes an outbound request to a client-supplied URL (webhooks, etc.) to
 * block SSRF against internal infrastructure.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid webhook URL');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('Webhook URL must use https');
    }

    const hostname = parsed.hostname;
    if (hostname === 'localhost') {
        throw new Error('Webhook URL not allowed');
    }

    if (net.isIP(hostname)) {
        if (isPrivateIp(hostname)) throw new Error('Webhook URL not allowed');
        return;
    }

    const addresses = await dns.promises.lookup(hostname, { all: true }).catch(() => []);
    for (const { address } of addresses) {
        if (isPrivateIp(address)) {
            throw new Error('Webhook URL resolves to a disallowed address');
        }
    }
}

/**
 * Throws if rawUrl is unsafe as a DAST scan target. Unlike webhooks, scanners
 * legitimately hit http:// as well as https://. By default private/link-local/
 * loopback/metadata targets are blocked (an authenticated user must not be able
 * to point ZAP/Nuclei/ffuf at 169.254.169.254 or an internal service). Set
 * DAST_ALLOW_PRIVATE_TARGETS=true to permit them when staging is itself internal.
 * ponytail: resolves DNS once — not rebinding-proof (host could re-resolve to a
 * private IP before the scanner connects). Pin the resolved IP through to the
 * scanner if you need TOCTOU-safe SSRF protection.
 */
export async function assertSafeScanTarget(rawUrl: string): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Invalid target URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Target URL must use http or https');
    }

    if (process.env.DAST_ALLOW_PRIVATE_TARGETS === 'true') return;

    const hostname = parsed.hostname;
    if (hostname === 'localhost') {
        throw new Error('Target URL not allowed (private/internal address)');
    }

    if (net.isIP(hostname)) {
        if (isPrivateIp(hostname)) throw new Error('Target URL not allowed (private/internal address)');
        return;
    }

    const addresses = await dns.promises.lookup(hostname, { all: true }).catch(() => []);
    for (const { address } of addresses) {
        if (isPrivateIp(address)) {
            throw new Error('Target URL resolves to a disallowed (private/internal) address');
        }
    }
}
