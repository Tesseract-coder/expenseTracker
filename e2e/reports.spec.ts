import { readFile } from 'node:fs/promises';
import { expect, type APIRequestContext, test } from '@playwright/test';
import { uid } from './helpers';

async function setup(request: APIRequestContext, name: string) {
  const account = (
    await (
      await request.post('/api/accounts', {
        data: { name, type: 'savings', openingBalanceDate: '2030-01-01' },
      })
    ).json()
  ).account.id as string;
  const cats = (await (await request.get('/api/categories')).json()).categories as {
    id: string;
    slug: string | null;
  }[];
  const id = (slug: string) => cats.find((c) => c.slug === slug)?.id;
  const add = (
    txnDate: string,
    rupees: number,
    direction: 'in' | 'out',
    slug: string,
    payee?: string,
  ) =>
    request.post('/api/transactions', {
      data: {
        accountId: account,
        txnDate,
        amountPaise: rupees * 100,
        direction,
        categoryId: id(slug),
        counterpartyName: payee ?? null,
      },
    });
  // March 2031: income 80,000; spend 20,000 (rent 15,000 + restaurants 6,000 − 1,000 refund); SIP 10,000.
  for (const r of await Promise.all([
    add('2031-03-01', 80_000, 'in', 'salary', 'Acme'),
    add('2031-03-03', 15_000, 'out', 'rent', 'Landlord'),
    add('2031-03-08', 6_000, 'out', 'restaurants', 'Cafe'),
    add('2031-03-09', 1_000, 'in', 'restaurants', 'Cafe'),
    add('2031-03-10', 10_000, 'out', 'mutual_funds', 'Groww'),
    add('2031-02-10', 25_000, 'out', 'rent', 'Landlord'),
  ]))
    expect(r.ok()).toBeTruthy();
  return { account, q: `period=month&date=2031-03-15&acc=${account}` };
}

test.describe('reports', () => {
  test('dashboard totals are correct and drill down to transactions', async ({
    page,
    request,
  }, info) => {
    const { q } = await setup(request, `Rpt ${uid(info)}`);
    await page.goto(`/?${q}`);
    const dash = page.getByRole('region', { name: 'Dashboard' });
    await expect(dash.getByText('March 2031')).toBeVisible();
    await expect(dash.getByText('Spent').locator('..')).toContainText('₹20,000.00');
    // Spend fell from ₹25,000 in February: 20% down, which is good.
    await expect(dash.getByText('Spent').locator('..')).toContainText('20% vs last month');
    const tile = (label: string) => dash.getByText(label, { exact: true }).locator('..');
    await expect(tile('Income')).toContainText('₹80,000.00');
    await expect(tile('Invested')).toContainText('₹10,000.00');
    await expect(tile('Net savings')).toContainText('₹60,000.00');
    await expect(tile('Savings rate')).toContainText('75.0%');

    await dash.getByRole('button', { name: /Lifestyle/ }).click();
    const restaurants = dash.getByRole('link', { name: /Restaurants & dining/ });
    await expect(restaurants).toContainText('₹5,000.00');
    await restaurants.click();
    await expect(page).toHaveURL(/\/transactions\?.*categoryIds=/);
    await expect(page.getByRole('button', { name: /Cafe/ })).toHaveCount(2);
  });

  test('health, budgets and the printable report', async ({ page, request }, info) => {
    const { q } = await setup(request, `Bud ${uid(info)}`);
    await page.goto(`/reports?tab=health&${q}`);
    await expect(page.getByText('Financial health · March 2031')).toBeVisible();
    await expect(page.getByText('Savings rate', { exact: true }).locator('../..')).toContainText(
      '75.0%',
    );

    await page.getByRole('tab', { name: 'Budgets' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'New budget' });
    await sheet.getByRole('button', { name: 'Choose' }).click();
    await page
      .getByRole('dialog', { name: 'Budget for' })
      .getByRole('button', { name: 'Restaurants & dining', exact: true })
      .click();
    await sheet.getByLabel('Monthly limit (₹)').fill('6000');
    await sheet.getByLabel('Only for Mar 31').click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    const meter = page.getByRole('meter', { name: /Restaurants & dining 83% used/ });
    await expect(meter).toBeVisible();
    await expect(page.getByText('80% used')).toBeVisible();

    await page.getByRole('tab', { name: 'Report' }).click();
    await expect(page.getByRole('heading', { name: 'Kharcha report — March 2031' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Net savings/ })).toContainText('₹60,000.00');
  });

  test('exports the report as XLSX and the transaction list as CSV', async ({
    page,
    request,
  }, info) => {
    const id = uid(info);
    const { q } = await setup(request, `Exp ${id}`);
    await page.goto(`/reports?tab=report&${q}`);
    const [xlsx] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download XLSX' }).click(),
    ]);
    expect(xlsx.suggestedFilename()).toBe('kharcha-report-2031-03-01-to-2031-03-31.xlsx');
    const bytes = await readFile((await xlsx.path()) as string);
    expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip container
    const names = bytes.toString('latin1');
    for (const n of [1, 2, 3, 4]) expect(names).toContain(`xl/worksheets/sheet${n}.xml`);

    await page.goto(`/transactions?from=2031-03-01&to=2031-03-31&q=Cafe`);
    await page.getByRole('button', { name: 'Export transactions' }).click();
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('dialog', { name: 'Export transactions' })
        .getByRole('button', { name: 'CSV' })
        .click(),
    ]);
    const text = await readFile((await csv.path()) as string, 'utf8');
    expect(text.split('\r\n')[0]).toContain('Date,Account,Payee,Narration,Category');
    expect(text).toContain(`Exp ${id},Cafe,,Restaurants & dining`);
    expect(text).toContain('6000,-6000');
  });
});
