import { test, expect } from '@playwright/test';

/**
 * Unauthenticated-surface smoke tests. No backend required: the app boots,
 * the login page renders, and protected routes bounce to /login client-side.
 */

test.describe('login page', () => {
  test('renders the operator login form', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /operator login/i })).toBeVisible();
    await expect(page.getByLabel(/vector id/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^login$/i })).toBeVisible();
  });

  test('shows a validation state when submitting empty credentials', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: /^login$/i }).click();

    // Native required-field validation keeps us on the login route.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('route protection', () => {
  for (const path of ['/', '/settings', '/reports', '/repos']) {
    test(`redirects unauthenticated visit to ${path} back to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe('enterprise SSO entry point', () => {
  test('is present only when the deployment enables it', async ({ page }) => {
    await page.goto('/login');

    const ssoButton = page.getByRole('link', { name: /single sign-on/i });
    if (process.env.VITE_SSO_ENABLED === 'true') {
      await expect(ssoButton).toBeVisible();
      await expect(ssoButton).toHaveAttribute('href', '/auth/sso/login');
    } else {
      await expect(ssoButton).toHaveCount(0);
    }
  });
});
