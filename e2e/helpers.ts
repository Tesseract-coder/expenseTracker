import { expect, type Page, type TestInfo } from '@playwright/test';

/** Unique per test + project so parallel runs against the shared dev user don't collide. */
export const uid = (info: TestInfo) =>
  `${info.project.name.replace(/\W/g, '')}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function createAccount(page: Page, name: string, opening = '1000') {
  await page.goto('/more/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add account' });
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Opening balance').fill(opening);
  await sheet.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('Account added')).toBeVisible();
}

export async function addTransaction(
  page: Page,
  opts: {
    amount: string;
    account: string;
    category?: string;
    note?: string;
    direction?: 'Expense' | 'Income';
  },
) {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add transaction' });
  if (opts.direction) await sheet.getByRole('radio', { name: opts.direction }).click();
  await sheet.getByLabel('Amount', { exact: true }).fill(opts.amount);
  if (opts.category) {
    await sheet.getByRole('button', { name: /Uncategorized — tap to choose/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose category' });
    await picker.getByRole('button', { name: opts.category, exact: true }).click();
    await expect(picker).toBeHidden();
  }
  await sheet.getByRole('radio', { name: opts.account }).click();
  if (opts.note) await sheet.getByLabel('Note').fill(opts.note);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();
}
