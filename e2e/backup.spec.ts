import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.describe('backup and restore', () => {
  test('downloads a full backup and walks through a restore', async ({ page }) => {
    await page.goto('/more');
    await page.getByRole('link', { name: 'Backup & restore' }).click();

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^kharcha-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const backup = JSON.parse(await readFile(path, 'utf8'));
    expect(backup).toMatchObject({ format: 'kharcha-backup', version: 1 });
    expect(backup.tables.accounts.length).toBeGreaterThan(0);
    expect(JSON.stringify(backup)).not.toContain('user_id');

    // The dev database is shared by every E2E test, so the restore calls are faked here; the
    // real restore is covered end-to-end by the API tests (apps/api/test/backup.test.ts).
    const calls: string[] = [];
    await page.route('**/api/backup/restore**', async (route) => {
      const url = new URL(route.request().url());
      calls.push(url.pathname);
      const counts = Object.fromEntries(
        Object.entries(backup.tables).map(([t, rows]) => [t, (rows as unknown[]).length]),
      );
      const body = url.pathname.endsWith('/restore')
        ? { restoreId: 'r1' }
        : url.pathname.endsWith('/finish')
          ? { counts }
          : { written: 1 };
      await route.fulfill({ status: url.pathname.endsWith('/restore') ? 201 : 200, json: body });
    });

    await page.locator('#backup-file').setInputFiles(path);
    await expect(page.getByText(/transactions · \d+ accounts/)).toBeVisible();
    const restore = page.getByRole('button', { name: 'Replace my data with this backup' });
    await expect(restore).toBeDisabled();
    await page.getByLabel('I understand this replaces all my current data').check();
    await restore.click();
    await expect(page.getByText(/Restored [\d,]+ transactions/)).toBeVisible();
    expect(calls[0]).toBe('/api/backup/restore');
    expect(calls.at(-1)).toBe('/api/backup/restore/finish');
  });

  test('rejects files that are not Kharcha backups', async ({ page }) => {
    await page.goto('/more/backup');
    await page.locator('#backup-file').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello": 1}'),
    });
    await expect(page.getByRole('alert')).toContainText("isn't a Kharcha backup");
  });
});
