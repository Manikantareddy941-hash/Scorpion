/**
 * Removes bearer credentials that travel in a URL path from anything headed for
 * a log.
 *
 * The Kubernetes admission webhook cannot send custom headers — a
 * ValidatingWebhookConfiguration exposes only `url`, `service` and `caBundle` —
 * so the cluster's tenant token has to live in the webhook URL. That makes it
 * prone to the classic credential-in-logs leak: access logs, rate-limit
 * warnings and auth failures all record `req.originalUrl`, and logs get shipped
 * to third parties and retained far longer than any token rotation window.
 *
 * Redaction happens here, in one place, rather than at each log site: a scheme
 * that depends on every future logger remembering to sanitise will leak the
 * first time someone adds a log line.
 */

/** Path segments after these carry a secret and must never be logged. */
const CREDENTIAL_BEARING_PREFIXES = ['/api/v1/webhook/k8s-admission/'];

/** Query params that carry credentials — JWTs ride the URL for SSE/EventSource,
 *  which cannot set headers. */
const SENSITIVE_QUERY_PARAMS = /([?&](?:token|jwt|apiKey|api_key)=)[^&#]*/gi;

export function redactUrl(url: string): string {
  for (const prefix of CREDENTIAL_BEARING_PREFIXES) {
    if (url.startsWith(prefix)) {
      // Keep the route identifiable so logs stay useful for debugging; drop the
      // credential and everything after it, query string included.
      return `${prefix}[REDACTED]`;
    }
  }
  return url.replace(SENSITIVE_QUERY_PARAMS, '$1[REDACTED]');
}
