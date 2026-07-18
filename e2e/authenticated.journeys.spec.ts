import { test, expect, Page } from '@playwright/test';

/**
 * Authenticated user journeys with the network layer mocked at the edge.
 * No live Appwrite/Redis needed: every Appwrite REST call and backend API
 * call the journeys touch is intercepted, so these run deterministically in
 * CI on the same production build the smoke suite uses.
 *
 * ponytail: mocked-network journeys, swap to real service containers when
 * the Appwrite-stack-in-CI lift is justified.
 */

const MOCK_USER = {
  $id: 'e2e-user-1',
  email: 'e2e@scorpion.test',
  name: 'E2E Operator',
  emailVerification: true,
  prefs: {},
  labels: [],
  status: true,
  registration: new Date().toISOString(),
};

const MOCK_SESSION = {
  $id: 'e2e-session-1',
  userId: MOCK_USER.$id,
  provider: 'email',
  current: true,
  expire: new Date(Date.now() + 86_400_000).toISOString(),
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// Two enriched findings + one stale unenriched one (SLA-breached critical).
const MOCK_VULNS = [
  {
    $id: 'vuln-kev',
    $createdAt: daysAgo(1),
    title: 'RCE in image parser',
    message: 'Remote code execution via crafted PNG',
    severity: 'HIGH',
    type: 'security',
    tool: 'trivy',
    file: 'src/parser.ts',
    line: 42,
    effort: '30min',
    kev: true,
    epss_score: 0.92,
    epss_percentile: 0.99,
    risk_score: 97,
  },
  {
    $id: 'vuln-mid',
    $createdAt: daysAgo(2),
    title: 'Outdated lodash',
    message: 'Prototype pollution in lodash < 4.17.21',
    severity: 'MEDIUM',
    type: 'security',
    tool: 'trivy',
    file: 'package.json',
    line: 12,
    effort: '10min',
    kev: false,
    epss_score: 0.03,
    epss_percentile: 0.6,
    risk_score: 21,
  },
  {
    $id: 'vuln-stale',
    $createdAt: daysAgo(14),
    title: 'Hardcoded secret',
    message: 'AWS key committed to repo',
    severity: 'CRITICAL',
    type: 'security',
    tool: 'gitleaks',
    file: 'config/dev.env',
    line: 3,
    effort: '5min',
    // no enrichment fields: exercises the severity-fallback path
  },
];

const MOCK_REPOS = [
  {
    $id: 'repo-1',
    $createdAt: daysAgo(30),
    name: 'acme-api',
    url: 'https://github.com/acme/api',
    cron_enabled: false,
    cron_schedule: '0 0 * * *',
    user_id: MOCK_USER.$id,
  },
];

const INSTALLATION_REPOS = [
  { installation_id: 7, account: 'acme', name: 'api', full_name: 'acme/api', html_url: 'https://github.com/acme/api', private: false },
  { installation_id: 7, account: 'acme', name: 'web', full_name: 'acme/web', html_url: 'https://github.com/acme/web', private: true },
  { installation_id: 7, account: 'acme', name: 'infra', full_name: 'acme/infra', html_url: 'https://github.com/acme/infra', private: true },
];

const collectionOf = (url: string): string | null => {
  const m = url.match(/collections\/([^/]+)\/documents/);
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * Arms every network mock an authenticated session needs. Appwrite calls are
 * matched on path regardless of the configured endpoint host; backend calls
 * are same-origin (/api/*).
 */
async function mockAuthenticatedBackend(page: Page): Promise<void> {
  // Playwright matches routes newest-first: register catch-alls FIRST so the
  // specific mocks below always win.
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));

  // Appwrite account surface
  await page.route('**/account/sessions/email', (route) =>
    route.fulfill({ json: MOCK_SESSION }),
  );
  await page.route(/\/account\/jwts?$/, (route) =>
    route.fulfill({ json: { jwt: 'e2e-jwt' } }),
  );
  await page.route('**/account/sessions/current', (route) =>
    route.fulfill({ json: MOCK_SESSION }),
  );
  await page.route('**/account', (route) => route.fulfill({ json: MOCK_USER }));

  // Appwrite databases: fixtures for the collections the journeys read,
  // empty result sets for everything else the dashboard fans out to.
  await page.route('**/databases/**/documents*', (route) => {
    const col = collectionOf(route.request().url());
    const docs =
      col && /vuln/i.test(col) ? MOCK_VULNS :
      col && /repo/i.test(col) ? MOCK_REPOS :
      [];
    return route.fulfill({ json: { total: docs.length, documents: docs } });
  });

  // Appwrite realtime tries a websocket; a failed upgrade is non-fatal and
  // the SDK degrades silently, so no mock needed.

  // Backend API surface used by the journeys
  await page.route('**/api/user/role', (route) =>
    route.fulfill({ json: { role: 'admin' } }),
  );
  // useTickets expects the paginated envelope; a bare {} leaves tickets
  // undefined and crashes IssueRow at render time.
  await page.route('**/api/tickets*', (route) =>
    route.fulfill({ json: { data: [], total: 0, page: 1, totalPages: 0 } }),
  );
  await page.route('**/api/repos/github/installations', (route) =>
    route.fulfill({ json: { repos: INSTALLATION_REPOS } }),
  );
  // Findings now come from the tenant-scoped backend route rather than a
  // direct Appwrite query. The catch-all above returns {}, which the page
  // correctly reads as "no documents" — so the fixture has to be served here
  // or the journeys see an empty issues list.
  await page.route('**/api/issues*', (route) =>
    route.fulfill({ json: { total: MOCK_VULNS.length, documents: MOCK_VULNS } }),
  );
  // The Repositories page reads its list from the backend now, not from
  // Appwrite. The catch-all above answers {} which is not an array.
  await page.route('**/api/repos', (route) =>
    route.fulfill({ json: MOCK_REPOS }),
  );
  await page.route('**/api/dashboard/security*', (route) =>
    route.fulfill({
      json: { latest_scan: { $id: 'scan-e2e', gateStatus: 'passed', score: 92 }, recent_findings: [] },
    }),
  );
}

test.describe('authenticated journeys', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedBackend(page);
  });

  test('login form drives a session: 401 until credentials are submitted', async ({ page }) => {
    // Stateful override (registered after beforeEach, so it wins): the user
    // is anonymous until the session-create call happens, exactly like a
    // fresh browser against a real Appwrite.
    let authed = false;
    await page.route('**/account', (route) =>
      authed
        ? route.fulfill({ json: MOCK_USER })
        : route.fulfill({ status: 401, json: { message: 'Unauthorized', code: 401, type: 'general_unauthorized_scope' } }),
    );
    await page.route('**/account/sessions/email', (route) => {
      authed = true;
      return route.fulfill({ json: MOCK_SESSION });
    });

    await page.goto('/login');
    await page.getByLabel(/vector id/i).fill(MOCK_USER.email);
    await page.locator('#password').fill('correct-horse-battery');
    await page.getByRole('button', { name: /^login$/i }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('issues page surfaces enrichment: risk sort, KEV badge, EPSS, SLA breach', async ({ page }) => {
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: /^issues$/i })).toBeVisible({ timeout: 15_000 });

    // Sort control present, Risk active by default
    const riskButton = page.getByRole('button', { name: /^risk$/i });
    await expect(riskButton).toBeVisible();
    await expect(riskButton).toHaveAttribute('aria-pressed', 'true');

    // KEV rollup badge on the file group header
    await expect(page.getByText('KEV', { exact: true }).first()).toBeVisible();

    // Highest risk file group first: the KEV'd RCE (risk 97) outranks the
    // unenriched CRITICAL (fallback 50)
    const groupHeaders = page.locator('span.font-mono');
    await expect(groupHeaders.first()).toHaveText(/src\/parser\.ts/);

    // Expand the top group: row shows EPSS column
    await page.getByText('src/parser.ts').click();
    await expect(page.getByText(/EPSS 92%/)).toBeVisible();

    // The 14-day-old critical breaches its 24h SLA → banner counts it
    await expect(page.getByText(/1 past SLA/)).toBeVisible();

    // Newest sort flips the group order
    await page.getByRole('button', { name: /^newest$/i }).click();
    await expect(groupHeaders.first()).toHaveText(/src\/parser\.ts/); // newest is 1d old RCE, still first
  });

  test('repositories bulk-import journey: list, select all, connect', async ({ page }) => {
    let bulkBody: { urls?: string[] } = {};
    await page.route('**/api/repos/bulk-connect', async (route) => {
      bulkBody = route.request().postDataJSON();
      await route.fulfill({ json: { connected: bulkBody.urls?.length ?? 0, failed: [] } });
    });

    await page.goto('/repos');
    await page.getByRole('button', { name: /import from github/i }).click();

    // All three installation repos listed, the already-connected one marked.
    // Scope to the modal: the repo card behind it also contains 'acme/api'.
    const modal = page.locator('.premium-card', { hasText: 'Import from GitHub' });
    await expect(modal.getByText('acme/api')).toBeVisible();
    await expect(modal.getByText('acme/web')).toBeVisible();
    await expect(modal.getByText('acme/infra')).toBeVisible();
    await expect(modal.getByText('Connected', { exact: true })).toBeVisible();

    // Select all → only the 2 not-yet-connected are selectable
    await modal.getByRole('button', { name: /select all/i }).click();
    await expect(modal.getByText(/2 of 2 selectable/)).toBeVisible();

    await modal.getByRole('button', { name: /^connect 2$/i }).click();

    await expect.poll(() => bulkBody.urls?.length).toBe(2);
    expect(bulkBody.urls).toEqual(
      expect.arrayContaining(['https://github.com/acme/web', 'https://github.com/acme/infra']),
    );
  });
});
