import { expect, test } from '@playwright/test';
import { uid } from './helpers';

/** Letters-only token: words with ≥5 digits are treated as reference numbers by the normalizer. */
const letters = (s: string) =>
  s.replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'x').toUpperCase();

test.describe('paste bank SMS', () => {
  test('parses alerts, matches the account, adds them once', async ({ page }, info) => {
    const id = uid(info);
    const name = `Kotak ${id}`;
    const last4 = String(1000 + Math.floor(Math.random() * 9000));
    const res = await page.request.post('/api/accounts', {
      data: { name, type: 'savings', bank: 'kotak', last4, openingBalanceDate: '2025-01-01' },
    });
    expect(res.ok()).toBeTruthy();
    const accountId = (await res.json()).account.id as string;
    const payee = `ZQ${letters(id)}`;
    const sms = [
      `Sent Rs.321.00 from Kotak Bank AC X${last4} to ${payee} on 15-07-25.UPI Ref 431012345678. Not you, https://kotak.com/fraud`,
      '',
      'Your OTP for txn is 482913. Do not share.',
    ].join('\n');

    await page.goto('/import/sms');
    await page.getByLabel('Bank messages').fill(sms);
    await page.getByRole('button', { name: 'Read messages' }).click();
    await expect(page.getByText('1 transaction found')).toBeVisible();
    await expect(page.getByText('Ignored messages (1)')).toBeVisible();
    // Other E2E accounts may share these digits; pick the account explicitly to be safe.
    await page.getByLabel('Account for message 1').selectOption(accountId);
    await page.getByRole('button', { name: 'Check for duplicates' }).click();

    await expect(page.getByRole('region', { name })).toContainText(new RegExp(payee, 'i'));
    await page.getByRole('button', { name: 'Add 1 transaction' }).click();
    await expect(page.getByRole('heading', { name: 'Added 1 transaction' })).toBeVisible();

    const list = await (await page.request.get(`/api/transactions?accountIds=${accountId}`)).json();
    expect(list.transactions).toHaveLength(1);
    expect(list.transactions[0]).toMatchObject({
      source: 'sms',
      status: 'confirmed',
      amountPaise: 32100,
      direction: 'out',
      txnDate: '2025-07-15',
      channel: 'upi',
    });

    // Pasting the same message again adds nothing.
    await page.getByRole('button', { name: 'Paste more' }).click();
    await page.getByLabel('Bank messages').fill(sms);
    await page.getByRole('button', { name: 'Read messages' }).click();
    await page.getByLabel('Account for message 1').selectOption(accountId);
    await page.getByRole('button', { name: 'Check for duplicates' }).click();
    await expect(page.getByText('1 already in Kharcha — will be skipped.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nothing new to add' })).toBeDisabled();
  });
});
