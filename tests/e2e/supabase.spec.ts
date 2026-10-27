import { test, expect } from '@playwright/test';
import { emptyData } from '../../src/lib/types';

// Opt-in: real configuration, no credentials, account creation or cloud writes.
test.skip(process.env.LIFE_OS_CHECK_SUPABASE !== '1', 'Requires configured Supabase smoke test opt-in');

test('configured server rejects unauthenticated data access', async ({ request }) => {
  const config = await request.get('/api/config');
  expect(config.status()).toBe(200);
  expect((await config.json()).supabaseConfigured).toBe(true);
  const data = await request.get('/api/data');
  expect(data.status()).toBe(401);
  expect(data.headers()['cache-control']).toBe('private, no-store');
  const callback = await request.get('/auth/callback', { maxRedirects: 0 });
  expect(callback.status()).toBe(307);
  expect(new URL(callback.headers().location).searchParams.has('auth_error')).toBe(true);
});

for (const width of [390, 1440]) test(`configured Auth form opens at ${width}px without changing local data`, async ({ page, context }) => {
  await context.addCookies([{ name: 'life-os-language', value: 'en', url: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000' }]);
  const seed = emptyData();
  seed.preferences.language = 'en';
  await page.addInitScript(data => {
    localStorage.setItem('life-os:language', 'en');
    localStorage.setItem('life-os:local:v1', JSON.stringify(data));
  }, seed);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your timeline' })).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('life-os:local:v1'));
  if (width < 768) await page.getByRole('button', { name: 'Open profile' }).click();
  else await page.locator('.profile-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Email address')).toBeVisible();
  await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(dialog.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => localStorage.getItem('life-os:local:v1'))).toBe(before);
});
