/**
 * Demo data: N months of realistic transactions for the local dev user (spec §11), for demos and
 * performance tests. Deterministic (seeded PRNG) and idempotent (INSERT OR IGNORE on fixed ids).
 *
 *   pnpm seed:demo                            # 12 months into the local D1
 *   pnpm seed:demo --months 24 --scale 5      # ~5k transactions for perf work
 *   pnpm seed:demo --months 24 --scale 12 --persist-to ../../.perf-state   # separate DB
 *   node scripts/seed-demo.ts > demo.sql      # just print the SQL
 *
 * Open the app once first (http://localhost:5173) so the dev user and its categories exist.
 * Demo accounts have no last-4 digits, so they never trigger transfer hints on real imports.
 * Self-contained on purpose (no workspace imports) so plain `node` can run it.
 */

const EMAIL = 'dev@kharcha.local';
const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const MONTHS = arg('months', 12);
const SCALE = Math.max(1, arg('scale', 1));
const END = new Date(Date.UTC(2026, 9, 31)); // last demo day: 31 Oct 2026

// ---------------------------------------------------------------------------- helpers

let seed = 20261031;
function rand(): number {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
  iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000));
const dow = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`).getUTCDay();
  return x === 0 ? 7 : x;
};
const weekStart = (d: string) => addDays(d, 1 - dow(d));
const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);

interface Txn {
  account: 'bank' | 'card';
  date: string;
  rupees: number;
  direction: 'in' | 'out';
  narration: string;
  channel: string;
  payee: string | null;
  payeeKey: string | null;
  slug: string;
  group?: string;
}

const txns: Txn[] = [];
const add = (t: Txn) => txns.push(t);
const upi = (name: string, vpa: string, slug: string, rupees: number, date: string) =>
  add({
    account: 'bank',
    date,
    rupees,
    direction: 'out',
    narration: `UPI/DR/${between(400000000000, 499999999999)}/${name.toUpperCase()}/YESB/${vpa}/Payment`,
    channel: 'upi',
    payee: name,
    payeeKey: vpa,
    slug,
  });
const card = (
  name: string,
  slug: string,
  rupees: number,
  date: string,
  direction: 'in' | 'out' = 'out',
) =>
  add({
    account: 'card',
    date,
    rupees,
    direction,
    narration: `${name.toUpperCase()} MUMBAI${direction === 'in' ? ' (REFUND)' : ''}`,
    channel: 'card',
    payee: name,
    payeeKey: name.toLowerCase(),
    slug,
  });

// ---------------------------------------------------------------------------- generate

for (let m = MONTHS - 1; m >= 0; m--) {
  const first = new Date(Date.UTC(END.getUTCFullYear(), END.getUTCMonth() - m, 1));
  const ym = iso(first).slice(0, 7);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = (d: number) => `${ym}-${String(Math.min(d, days)).padStart(2, '0')}`;
  const anyDay = () => day(between(1, days));
  const progress = (MONTHS - m) / MONTHS; // 0 → 1: food delivery creeps up over the year

  add({
    account: 'bank',
    date: day(1),
    rupees: 120_000,
    direction: 'in',
    narration: `NEFT CR-HDFC0000123-ACME TECH PVT LTD-SALARY ${ym}`,
    channel: 'neft',
    payee: 'Acme Tech',
    payeeKey: 'acme tech',
    slug: 'salary',
  });
  upi('Landlord Sharma', 'sharma.rent@okhdfcbank', 'rent', 30_000, day(3));
  add({
    account: 'bank',
    date: day(5),
    rupees: 15_000,
    direction: 'out',
    narration: 'ACH/GROWW-SIP/ICIC7012345678901',
    channel: 'ach',
    payee: 'Groww',
    payeeKey: 'groww',
    slug: 'mutual_funds',
  });
  upi('MSEDCL', 'msedcl@sbi', 'electricity', between(1_800, 3_200), day(10));
  upi('Jio', 'jio@axisbank', 'mobile_recharge', 299, day(15));
  upi('Society', 'society.maint@okicici', 'society_maintenance', 3_500, day(7));
  card('Netflix', 'entertainment', m < 2 ? 799 : 649, day(12));
  if (m % 3 === 0)
    add({
      account: 'bank',
      date: day(28),
      rupees: between(900, 1_400),
      direction: 'in',
      narration: 'CREDIT INTEREST',
      channel: 'interest',
      payee: null,
      payeeKey: null,
      slug: 'interest',
    });

  for (let s = 0; s < SCALE; s++) {
    for (let i = between(6, 10); i > 0; i--)
      upi(
        pick(['Blinkit', 'Zepto', 'DMart', 'Bigbasket']),
        pick(['blinkit@ybl', 'zepto.payu@hdfcbank', 'dmart@icici', 'bigbasket@okaxis']),
        'grocery',
        between(300, 3_000),
        anyDay(),
      );
    for (let i = between(6, 9) + Math.round(progress * 8); i > 0; i--)
      upi(
        pick(['Swiggy', 'Zomato']),
        pick(['swiggy@ybl', 'zomato@paytm']),
        'food_delivery',
        between(200, 900),
        anyDay(),
      );
    for (let i = between(2, 4); i > 0; i--)
      card(
        pick(['Barbeque Nation', 'Starbucks', 'Cafe Mocha']),
        'restaurants',
        between(600, 3_000),
        anyDay(),
      );
    for (let i = between(6, 12); i > 0; i--)
      card(pick(['Uber', 'Rapido', 'Ola']), 'cab_auto', between(120, 600), anyDay());
    for (let i = between(1, 3); i > 0; i--)
      card(
        pick(['Amazon', 'Myntra', 'Flipkart']),
        'online_shopping',
        between(500, 6_000),
        anyDay(),
      );
    if (rand() < 0.3) card('Amazon', 'online_shopping', between(300, 1_500), anyDay(), 'in');
    for (let i = 2; i > 0; i--) card('Indian Oil', 'petrol', between(1_500, 2_500), anyDay());
    for (let i = between(1, 3); i > 0; i--)
      add({
        account: 'bank',
        date: anyDay(),
        rupees: between(100, 800),
        direction: 'out',
        narration: `UPI/DR/${between(400000000000, 499999999999)}/RAVI/SBIN/ravi${between(1, 9)}@okaxis/x`,
        channel: 'upi',
        payee: 'Ravi',
        payeeKey: null,
        slug: 'uncategorized',
      });
  }
}

// Credit card bill: pay last month's card spend on the 20th, as a linked transfer.
const cardByMonth = new Map<string, number>();
for (const t of txns)
  if (t.account === 'card')
    cardByMonth.set(
      t.date.slice(0, 7),
      (cardByMonth.get(t.date.slice(0, 7)) ?? 0) + (t.direction === 'out' ? t.rupees : -t.rupees),
    );
const months = [...cardByMonth.keys()].sort();
months.slice(0, -1).forEach((ym, i) => {
  const payMonth = months[i + 1] as string;
  const amount = cardByMonth.get(ym) as number;
  const group = `demo-tg-${ym}`;
  add({
    account: 'bank',
    date: `${payMonth}-20`,
    rupees: amount,
    direction: 'out',
    narration: 'TO TRANSFER-INB HDFC CREDIT CARD BILL PAYMENT XX4321',
    channel: 'neft',
    payee: null,
    payeeKey: null,
    slug: 'cc_bill_payment',
    group,
  });
  add({
    account: 'card',
    date: `${payMonth}-20`,
    rupees: amount,
    direction: 'in',
    narration: 'PAYMENT RECEIVED, THANK YOU',
    channel: 'card',
    payee: null,
    payeeKey: null,
    slug: 'cc_bill_payment',
    group,
  });
});

// ---------------------------------------------------------------------------- SQL

const user = `(select id from users where email = '${EMAIL}')`;
const out: string[] = [
  '-- Generated by scripts/seed-demo.ts',
  `insert or ignore into accounts (id, user_id, name, bank, type, last4, opening_balance_paise, opening_balance_date, color, active, sort_order, created_at, updated_at)
   select 'demo-acc-bank', id, 'Demo HDFC Salary', 'hdfc', 'savings', null, 5000000, '${addDays(iso(END), -MONTHS * 31)}', '#2a78d6', 1, 10, 0, 0 from users where email = '${EMAIL}';`,
  `insert or ignore into accounts (id, user_id, name, bank, type, last4, opening_balance_paise, opening_balance_date, color, active, sort_order, created_at, updated_at)
   select 'demo-acc-card', id, 'Demo HDFC Card', 'hdfc', 'credit_card', null, 0, '${addDays(iso(END), -MONTHS * 31)}', '#eb6834', 1, 11, 0, 0 from users where email = '${EMAIL}';`,
];
const payees = new Map<string, string>();
for (const t of txns) if (t.payeeKey && t.payee) payees.set(t.payeeKey, t.payee);
for (const [key, name] of payees) {
  out.push(
    `insert or ignore into counterparties (id, user_id, key, display_name, vpa, txn_count, created_at, updated_at) select 'demo-cp-${key.replace(/[^a-z0-9]/g, '-')}', id, ${q(key)}, ${q(name)}, ${key.includes('@') ? q(key) : 'null'}, 0, 0, 0 from users where email = '${EMAIL}';`,
  );
}
txns.sort((a, b) => (a.date < b.date ? -1 : 1));
txns.forEach((t, i) => {
  const cat = `(select id from categories where user_id = ${user} and slug = '${t.slug}')`;
  const cp = t.payeeKey
    ? `(select id from counterparties where user_id = ${user} and key = ${q(t.payeeKey)})`
    : 'null';
  const by = t.slug === 'uncategorized' ? 'none' : t.group ? 'manual' : 'keyword';
  const ts = Date.parse(`${t.date}T06:00:00Z`) + i;
  out.push(
    `insert or ignore into transactions (id, user_id, account_id, txn_date, week_start, dow, amount_paise, direction, raw_narration, channel, counterparty_id, vpa, category_id, categorized_by, is_split, status, source, fingerprint, transfer_group_id, is_reimbursable, created_at, updated_at) values ('demo-t-${i}', ${user}, 'demo-acc-${t.account}', '${t.date}', '${weekStart(t.date)}', ${dow(t.date)}, ${t.rupees * 100}, '${t.direction}', ${q(t.narration)}, '${t.channel}', ${cp}, ${t.payeeKey?.includes('@') ? q(t.payeeKey) : 'null'}, ${cat}, '${by}', 0, 'confirmed', 'import', 'demo|${i}', ${q(t.group ?? null)}, 0, ${ts}, ${ts});`,
  );
});
out.push(
  `update counterparties set txn_count = (select count(*) from transactions t where t.counterparty_id = counterparties.id), last_seen_date = (select max(txn_date) from transactions t where t.counterparty_id = counterparties.id) where user_id = ${user};`,
);
const sql = `${out.join('\n')}\n`;
process.stderr.write(
  `seed-demo: ${txns.length} transactions over ${MONTHS} months (scale ${SCALE})\n`,
);
if (args.includes('--apply')) {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const apiDir = fileURLToPath(new URL('../apps/api/', import.meta.url));
  mkdirSync(`${apiDir}.wrangler`, { recursive: true });
  writeFileSync(`${apiDir}.wrangler/demo-seed.sql`, sql);
  const persist = args.indexOf('--persist-to');
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      '--file',
      '.wrangler/demo-seed.sql',
      ...(persist >= 0 ? ['--persist-to', args[persist + 1] as string] : []),
    ],
    {
      cwd: apiDir,
      stdio: 'inherit',
    },
  );
} else {
  process.stdout.write(sql);
}
