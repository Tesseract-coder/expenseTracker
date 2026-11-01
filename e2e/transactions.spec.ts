import { expect, test } from '@playwright/test';
import { addTransaction, createAccount, uid } from './helpers';

test.describe('manual transactions', () => {
  test('add an expense, see it in the list and in the account balance', async ({ page }, info) => {
    const id = uid(info);
    const account = `Bank ${id}`;
    await createAccount(page, account, '1,000');
    await expect(page.getByRole('button', { name: new RegExp(account) })).toContainText(
      '₹1,000.00',
    );

    await page.goto('/');
    await addTransaction(page, {
      amount: '250.50',
      account,
      category: 'Grocery',
      note: `veg ${id}`,
    });

    await page.goto(`/transactions?q=${id}`);
    const row = page.getByRole('button', { name: new RegExp(`veg ${id}`) });
    await expect(row).toContainText('Grocery');
    await expect(row).toContainText('−₹250.50');

    await page.goto('/more/accounts');
    await expect(page.getByRole('button', { name: new RegExp(account) })).toContainText('₹749.50');
  });

  test('validates the amount before saving', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add transaction' });
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Enter an amount');
  });

  test('edit into a split, then delete and undo', async ({ page }, info) => {
    const id = uid(info);
    const account = `Split ${id}`;
    await createAccount(page, account, '0');
    await addTransaction(page, {
      amount: '1500',
      account,
      category: 'Grocery',
      note: `dmart ${id}`,
    });

    await page.goto(`/transactions?q=${id}`);
    await page.getByRole('button', { name: new RegExp(`dmart ${id}`) }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit transaction' });
    await sheet.getByRole('button', { name: 'Split', exact: true }).click();

    await sheet.getByRole('button', { name: 'Part 1 category' }).click();
    await page
      .getByRole('dialog', { name: 'Choose category' })
      .getByRole('button', { name: 'Grocery', exact: true })
      .click();
    await sheet.getByLabel('Part 1 amount').fill('1000');
    await sheet.getByRole('button', { name: 'Part 2 category' }).click();
    await page
      .getByRole('dialog', { name: 'Choose category' })
      .getByRole('button', { name: 'Home repairs', exact: true })
      .click();
    await sheet.getByLabel('Part 2 amount').fill('400');
    await expect(sheet.getByText('₹100.00 left')).toBeVisible();
    await sheet.getByLabel('Part 2 amount').fill('500');
    await expect(sheet.getByText('Balanced')).toBeVisible();
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(sheet).toBeHidden();

    const row = page.getByRole('button', { name: new RegExp(`dmart ${id}`) });
    await expect(row).toContainText('Split · 2 parts');

    await row.click();
    await page
      .getByRole('dialog', { name: 'Edit transaction' })
      .getByRole('button', { name: 'Delete transaction' })
      .click();
    await expect(row).toBeHidden();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: new RegExp(`dmart ${id}`) })).toContainText(
      'Split · 2 parts',
    );
  });

  test('filters by direction and searches by amount', async ({ page }, info) => {
    const id = uid(info);
    const account = `Filter ${id}`;
    await createAccount(page, account, '0');
    await addTransaction(page, {
      amount: '90000',
      account,
      direction: 'Income',
      category: 'Salary',
      note: `pay ${id}`,
    });
    await addTransaction(page, {
      amount: '321.75',
      account,
      category: 'Food delivery',
      note: `food ${id}`,
    });

    await page.goto(`/transactions?q=${id}`);
    await expect(page.getByRole('button', { name: new RegExp(`(pay|food) ${id}`) })).toHaveCount(2);
    await page.getByRole('button', { name: 'Income', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`food ${id}`) })).toBeHidden();
    await expect(page.getByRole('button', { name: new RegExp(`pay ${id}`) })).toContainText(
      '+₹90,000.00',
    );

    await page.goto('/transactions');
    await page.getByLabel('Search transactions').fill('321.75');
    await expect(page.getByRole('button', { name: new RegExp(`food ${id}`) })).toBeVisible();
  });
});

test.describe('categories', () => {
  test('add a category to a group and use it', async ({ page }, info) => {
    const id = uid(info);
    const name = `Pets ${id}`;
    await page.goto('/more/categories');
    await page.getByRole('button', { name: 'Add category to Household / Essentials' }).click();
    const sheet = page.getByRole('dialog', { name: /New category in Household/ });
    await sheet.getByLabel('Name').fill(name);
    await sheet.getByRole('radio', { name: 'paw-print' }).click();
    await sheet.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();

    await page.getByRole('button', { name, exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit category' });
    await edit.getByLabel('Name').fill(`${name} care`);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: `${name} care`, exact: true })).toBeVisible();
  });
});
