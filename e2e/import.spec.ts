import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { uid } from './helpers';

const fixture = (p: string) => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

async function createAccount(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/accounts', {
    data: { type: 'savings', openingBalanceDate: '2026-09-30', ...body },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).account.id as string;
}

async function chooseFile(
  page: Page,
  accountName: string,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto('/import');
  await page.getByLabel('Account').selectOption({ label: accountName });
  await page.locator('#statement-file').setInputFiles(file);
}

test.describe('statement import', () => {
  test('auto-detects an HDFC statement, reconciles the balance and imports it once', async ({
    page,
  }, info) => {
    const name = `HDFC ${uid(info)}`;
    await createAccount(page, { name, bank: 'hdfc', openingBalancePaise: 5000000 });

    await chooseFile(page, name, fixture('hdfc/savings.xlsx'));
    await expect(page.getByText(`HDFC Bank — Savings/Current → ${name}`)).toBeVisible();
    const summary = page.getByLabel('Summary');
    await expect(summary.getByText('New').locator('..')).toContainText('8');
    await expect(
      page.getByRole('status').filter({ hasText: 'matches the statement' }),
    ).toContainText('₹1,04,851.50');

    // The CC autopay row is suggested as a card-bill payment and pre-ticked.
    const transfers = page.getByRole('region', { name: /Transfers detected/ });
    await expect(transfers).toContainText('Credit card bill payment');
    await expect(transfers.getByRole('checkbox')).toBeChecked();

    await page.getByRole('button', { name: 'Import 8 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 8 transactions' })).toBeVisible();

    await page.getByRole('link', { name: 'View transactions' }).click();
    // Phase 3: rows show the normalized payee and the engine's category.
    await expect(page.getByRole('button', { name: /Chai Point/ })).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Chai Point/ }).first()).toContainText(
      'Restaurants & dining',
    );
    await expect(page.getByRole('button', { name: /Autopay/i })).toContainText(
      'Credit card bill payment',
    );

    // Same file again: nothing new.
    await chooseFile(page, name, fixture('hdfc/savings.xlsx'));
    await expect(
      page.getByRole('alert').filter({ hasText: 'already imported this exact file' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled();
  });

  test('maps an unknown format once, then reuses the saved columns', async ({ page }, info) => {
    const name = `Coop ${uid(info)}`;
    await createAccount(page, { name });
    const csv = (rows: string[]) => ({
      name: 'coop.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        ['Co-op Bank Ltd', 'Posting Date,Details,Debit Amount,Credit Amount,Balance', ...rows].join(
          '\n',
        ),
      ),
    });

    await chooseFile(
      page,
      name,
      csv(['01/10/2026,Milk vendor,320.00,,9680.00', '02/10/2026,Salary,,50000.00,59680.00']),
    );
    await expect(page.getByRole('alert')).toContainText("didn't recognise this format");
    await expect(page.getByLabel('Parse preview')).toContainText('2 transactions found');
    // The raw-sheet table scrolls inside its own container; the page itself must not overflow.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.getByRole('button', { name: 'Use these columns' }).click();
    await page.getByRole('button', { name: 'Import 2 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 2 transactions' })).toBeVisible();

    await chooseFile(page, name, csv(['03/10/2026,Newspaper,150.00,,59530.00']));
    await expect(page.getByText(`${name} statement → ${name}`)).toBeVisible();
    await page.getByRole('button', { name: 'Import 1 transaction' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 1 transaction' })).toBeVisible();
  });

  test('reverts an import from history', async ({ page }, info) => {
    const name = `Kotak ${uid(info)}`;
    await createAccount(page, { name, bank: 'kotak' });
    await chooseFile(page, name, fixture('kotak/savings.csv'));
    await page.getByRole('button', { name: 'Import 5 transactions' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 5 transactions' })).toBeVisible();

    await page.goto('/more/imports');
    const item = page.getByRole('listitem').filter({ hasText: name });
    await expect(item).toContainText('5 new');
    await item.getByRole('button', { name: 'Revert' }).click();
    await page
      .getByRole('dialog', { name: 'Revert this import?' })
      .getByRole('button', { name: 'Revert import' })
      .click();
    await expect(page.getByText('Removed 5 transactions')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toContainText('Reverted');
  });
});
