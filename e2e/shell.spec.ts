import { expect, test } from '@playwright/test';

test.describe('PWA shell', () => {
  test('loads home and the API is healthy', async ({ page, request }) => {
    const health = await request.get('/api/health');
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toMatchObject({ status: 'ok', db: 'ok' });

    await page.goto('/more');
    await expect(page.getByText('Signed in as dev@kharcha.local')).toBeVisible();
  });

  test('bottom nav reaches every section with 44px+ tap targets', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const [label, title] of [
      ['Transactions', 'Transactions'],
      ['Reports', 'Reports'],
      ['More', 'More'],
      ['Home', 'Kharcha'],
    ] as const) {
      const link = nav.getByRole('link', { name: label });
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      await link.click();
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    }
  });

  test('deep links work (SPA fallback) and More shows seeded categories', async ({ page }) => {
    await page.goto('/more');
    await expect(page.getByText('API ok · DB ok')).toBeVisible();
    await expect(page.getByText(/^\d+ categories$/)).toBeVisible();
  });

  test('privacy toggle blurs amounts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-money]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Hide amounts' }).click();
    await expect(page.locator('html')).toHaveClass(/privacy-blur/);
    const filter = await page
      .locator('[data-money]')
      .first()
      .evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('blur');
  });

  test('has no horizontal overflow on mobile, even with long names', async ({ page, request }) => {
    // A long unbreakable account name used to push the layout wider than the viewport.
    await request.post('/api/accounts', {
      data: {
        name: `Overflow${'x'.repeat(60)}${Date.now()}`,
        type: 'savings',
        openingBalanceDate: '2026-01-01',
      },
    });
    for (const path of [
      '/',
      '/transactions',
      '/more',
      '/more/accounts',
      '/more/categories',
      '/import',
      '/more/imports',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBe(false);
    }
  });
});
