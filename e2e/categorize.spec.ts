import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import { uid as rawUid } from './helpers';

/** Letters only: digit-heavy words look like reference numbers and are stripped from payee names. */
const uid = (info: Parameters<typeof rawUid>[0]) =>
  rawUid(info).replace(/\d/g, (d) => 'abcdefghij'[Number(d)] as string);

/** Imports rows through the API (upload → preview → commit) so tests focus on labelling. */
async function importViaApi(
  request: APIRequestContext,
  accountId: string,
  rows: { narration: string; amountPaise: number; txnDate: string; direction?: 'in' | 'out' }[],
) {
  const up = await request.post('/api/imports', {
    multipart: {
      accountId,
      file: { name: 'st.csv', mimeType: 'text/csv', buffer: Buffer.from(`${Math.random()}`) },
    },
  });
  expect(up.ok()).toBeTruthy();
  const { importId } = await up.json();
  const preview = await request.post(`/api/imports/${importId}/preview`, {
    data: {
      profileId: 'custom',
      rows: rows.map((r, i) => ({
        valueDate: null,
        refNo: null,
        balancePaise: null,
        direction: 'out',
        sourceRow: i + 1,
        ...r,
      })),
      statementFrom: null,
      statementTo: null,
      closingBalancePaise: null,
      parseErrors: 0,
    },
  });
  expect(preview.ok()).toBeTruthy();
  const commit = await request.post(`/api/imports/${importId}/commit`, { data: {} });
  expect(commit.ok()).toBeTruthy();
  return (await preview.json()) as { rows: { proposal: { categorizedBy: string } | null }[] };
}

async function account(request: APIRequestContext, name: string) {
  const res = await request.post('/api/accounts', {
    data: { name, type: 'savings', openingBalanceDate: '2026-01-01' },
  });
  return (await res.json()).account.id as string;
}

/** A UPI narration unique to this test (the dev user is shared across tests). */
const upi = (id: string, n: number) =>
  `UPI/DR/4275${String(n).padStart(8, '0')}/VENDOR ${id.toUpperCase()}/SBIN/v${id.toLowerCase()}@okaxis/x`;

/**
 * The inbox lists newest first and the shared dev DB keeps rows from earlier runs, so inbox tests
 * use a date after everything else to stay on the first page.
 */
const INBOX_DATE = '2030-01-01';

const inboxCard = (page: Page, id: string, amount: string) =>
  page
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`Vendor ${id}`, 'i') })
    .filter({ hasText: amount });

test.describe('categorization', () => {
  test('label from the inbox with "All future", and the next import auto-labels', async ({
    page,
    request,
  }, info) => {
    const id = uid(info);
    const acc = await account(request, `Lbl ${id}`);
    await importViaApi(request, acc, [
      { narration: upi(id, 1), amountPaise: 12345, txnDate: INBOX_DATE },
    ]);

    await page.goto('/inbox');
    const card = inboxCard(page, id, '123.45');
    await card.getByRole('button', { name: /More categories/ }).click();
    await page
      .getByRole('dialog', { name: 'Categorize as' })
      .getByRole('button', { name: 'Grocery', exact: true })
      .click();

    const prompt = page.getByRole('dialog', { name: 'Remember this?' });
    await expect(prompt).toContainText(/Always categorize Vendor/i);
    await expect(prompt.getByRole('radio', { name: /All future/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await prompt.getByRole('button', { name: 'Categorize and remember' }).click();
    await expect(page.getByText(/Categorized as Grocery · will remember/)).toBeVisible();
    await expect(card).toHaveCount(0);

    // The next statement from the same payee is labelled automatically.
    const next = await importViaApi(request, acc, [
      { narration: upi(id, 2), amountPaise: 67800, txnDate: '2026-11-01' },
    ]);
    expect(next.rows[0]?.proposal?.categorizedBy).toBe('learned');
    await page.goto(`/transactions?q=${encodeURIComponent(`v${id.toLowerCase()}`)}`);
    await page.getByLabel('Search transactions').fill(`Vendor ${id}`);
    const row = page.getByRole('button', { name: new RegExp(`Vendor ${id}.*678\\.00`, 'i') });
    await expect(row).toContainText('Grocery');
    await row.click();
    await expect(page.getByRole('dialog', { name: 'Edit transaction' })).toContainText(
      'Why: You categorized this payee before',
    );

    await page.goto('/more/rules');
    await page.getByRole('tab', { name: 'Learned labels' }).click();
    await expect(
      page.getByRole('button', { name: new RegExp(`^Vendor ${id}`, 'i') }),
    ).toContainText('Grocery');
  });

  test('bulk-label from the inbox and undo', async ({ page, request }, info) => {
    const id = uid(info);
    const acc = await account(request, `Bulk ${id}`);
    await importViaApi(request, acc, [
      { narration: upi(id, 1), amountPaise: 1111, txnDate: INBOX_DATE },
      { narration: upi(id, 2), amountPaise: 2222, txnDate: INBOX_DATE },
    ]);
    await page.goto('/inbox');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await inboxCard(page, id, '11.11').getByRole('checkbox').check();
    await inboxCard(page, id, '22.22').getByRole('checkbox').check();
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Categorize', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Categorize 2 transactions' })
      .getByRole('button', { name: 'Medical & pharmacy', exact: true })
      .click();
    await expect(page.getByText('2 categorized as Medical & pharmacy')).toBeVisible();
    await expect(inboxCard(page, id, '11.11')).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Undone')).toBeVisible();
    await expect(inboxCard(page, id, '11.11')).toHaveCount(1);
    await expect(inboxCard(page, id, '22.22')).toHaveCount(1);
  });

  test('swipe a row to recategorize; long-press to multi-select', async ({
    page,
    request,
  }, info) => {
    const id = uid(info);
    const acc = await account(request, `Swipe ${id}`);
    await importViaApi(request, acc, [
      { narration: upi(id, 1), amountPaise: 4321, txnDate: '2026-10-04' },
      { narration: upi(id, 2), amountPaise: 8765, txnDate: '2026-10-05' },
    ]);
    await page.goto('/transactions');
    await page.getByLabel('Search transactions').fill(`Vendor ${id}`);
    const row = page.getByRole('button', { name: new RegExp(`Vendor ${id}.*43\\.21`, 'i') });
    await expect(row).toBeVisible();

    const box = (await row.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 20, y);
    await page.mouse.down();
    for (let dx = 0; dx <= 150; dx += 15) await page.mouse.move(box.x + box.width - 20 - dx, y);
    await page.mouse.up();
    await page
      .getByRole('dialog', { name: 'Categorize as' })
      .getByRole('button', { name: 'Restaurants & dining', exact: true })
      .click();
    const prompt = page.getByRole('dialog', { name: 'Remember this?' });
    await prompt.getByRole('radio', { name: /This one only/ }).click();
    await prompt.getByRole('button', { name: 'Categorize', exact: true }).click();
    await expect(row).toContainText('Restaurants & dining');

    const other = page.getByRole('button', { name: new RegExp(`Vendor ${id}.*87\\.65`, 'i') });
    const b = (await other.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByText('1 selected')).toBeVisible();
    await expect(other).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Cancel selection' }).click();
    await expect(page.getByText('1 selected')).toBeHidden();
  });

  test('create a rule, test it against history, then apply it to the past', async ({
    page,
    request,
  }, info) => {
    const id = uid(info);
    const word = `ZZRULE${id}`.toUpperCase();
    const acc = await account(request, `Rule ${id}`);
    await importViaApi(request, acc, [
      {
        narration: `NEFT-SBIN0001234-${word} SOCIETY-OCT`,
        amountPaise: 350000,
        txnDate: '2026-10-05',
      },
      {
        narration: `NEFT-SBIN0001234-${word} SOCIETY-SEP`,
        amountPaise: 350000,
        txnDate: '2026-09-05',
      },
    ]);

    await page.goto('/more/rules');
    await page.getByRole('button', { name: 'New rule' }).click();
    const editor = page.getByRole('dialog', { name: 'New rule' });
    await editor.getByLabel('Name').fill(`Society ${id}`);
    await editor.getByLabel('Condition 1 value').fill(word.toLowerCase());
    await editor.getByRole('button', { name: 'Choose category' }).click();
    await page
      .getByRole('dialog', { name: 'Choose category' })
      .getByRole('button', { name: 'Home repairs', exact: true })
      .click();
    await editor.getByRole('button', { name: 'Test against my history' }).click();
    await expect(editor.getByText(/Matches 2 of 2/)).toBeVisible();

    await editor.getByRole('button', { name: 'Save & apply' }).click();
    await expect(page.getByText('Rule saved · 2 past transactions updated')).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`\\d+\\. Society ${id}`) }),
    ).toContainText('Home repairs');

    await page.goto('/transactions');
    await page.getByLabel('Search transactions').fill(word);
    const rows = page.getByRole('button', { name: new RegExp(`${word}.*3,500\\.00`, 'i') });
    await expect(rows).toHaveCount(2);
    for (const r of await rows.all()) {
      await expect(r).toContainText('Home repairs');
    }
  });
});
