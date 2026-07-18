import { redactUrl } from './redactUrl';

/**
 * The admission webhook carries its tenant token in the URL path, because a
 * ValidatingWebhookConfiguration cannot send custom headers. Access logs are a
 * classic credential-leak vector, so nothing may reach a log with the token in it.
 */
describe('redactUrl', () => {
  it('strips the admission token from the path', () => {
    const url = '/api/v1/webhook/k8s-admission/scrp_0123456789abcdef';
    expect(redactUrl(url)).toBe('/api/v1/webhook/k8s-admission/[REDACTED]');
    expect(redactUrl(url)).not.toContain('scrp_');
  });

  it('strips a query string that follows the admission token', () => {
    const redacted = redactUrl('/api/v1/webhook/k8s-admission/scrp_secret?debug=1');
    expect(redacted).not.toContain('scrp_secret');
  });

  it('keeps the untokenised admission path intact', () => {
    // Legacy single-tenant deployments post here; there is no credential to hide.
    expect(redactUrl('/api/v1/webhook/k8s-admission')).toBe('/api/v1/webhook/k8s-admission');
  });

  it('still strips credential-bearing query params on other routes', () => {
    // SSE/EventSource cannot set headers, so JWTs ride the query string.
    expect(redactUrl('/api/events?token=secret-jwt')).toBe('/api/events?token=[REDACTED]');
    expect(redactUrl('/api/x?api_key=abc&page=2')).toBe('/api/x?api_key=[REDACTED]&page=2');
  });

  it('leaves an ordinary URL untouched', () => {
    expect(redactUrl('/api/tickets?page=2')).toBe('/api/tickets?page=2');
  });
});
