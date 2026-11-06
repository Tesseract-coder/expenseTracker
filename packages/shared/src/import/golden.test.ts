/**
 * Golden-file tests: fixture statement in → detected profile + parsed rows out.
 * Regenerate after an intentional change: UPDATE_GOLDEN=1 pnpm --filter @kharcha/shared test golden
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { AccountType, Bank } from '../schemas/enums';
import { readSpreadsheet } from '../spreadsheet';
import { parseGrid } from './mapping';
import { readPdfStatement } from './pdfRead';
import { detectProfile } from './profiles';

const fixture = (p: string) => fileURLToPath(new URL(`../../../../fixtures/${p}`, import.meta.url));

const CASES: { file: string; bank: Bank; type: AccountType; profile: string }[] = [
  { file: 'hdfc/savings.xlsx', bank: 'hdfc', type: 'savings', profile: 'hdfc_savings_v1' },
  { file: 'hdfc/credit-card.csv', bank: 'hdfc', type: 'credit_card', profile: 'hdfc_cc_v1' },
  { file: 'icici/savings.xlsx', bank: 'icici', type: 'savings', profile: 'icici_savings_v1' },
  { file: 'icici/credit-card.csv', bank: 'icici', type: 'credit_card', profile: 'icici_cc_v1' },
  { file: 'sbi/savings.txt', bank: 'sbi', type: 'savings', profile: 'sbi_savings_v1' },
  { file: 'sbi/credit-card.csv', bank: 'sbi', type: 'credit_card', profile: 'sbi_cc_v1' },
  { file: 'axis/savings.csv', bank: 'axis', type: 'savings', profile: 'axis_savings_v1' },
  { file: 'axis/credit-card.csv', bank: 'axis', type: 'credit_card', profile: 'axis_cc_v1' },
  { file: 'kotak/savings.csv', bank: 'kotak', type: 'savings', profile: 'kotak_savings_v1' },
  { file: 'kotak/credit-card.csv', bank: 'kotak', type: 'credit_card', profile: 'kotak_cc_v1' },
  {
    file: 'hdfc/savings-protected.pdf',
    bank: 'hdfc',
    type: 'savings',
    profile: 'hdfc_savings_v1',
  },
  { file: 'icici/savings.pdf', bank: 'icici', type: 'savings', profile: 'icici_savings_v1' },
];

/** PDF fixtures come from scripts/generate-pdf-fixtures.ts. */
const PDF_PASSWORDS: Record<string, string> = { 'hdfc/savings-protected.pdf': 'SAMPLE1234' };

function bytes(file: string): ArrayBuffer {
  const buf = readFileSync(fixture(file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function load(file: string) {
  if (file.endsWith('.pdf'))
    return readPdfStatement(pdfjs as never, bytes(file), { password: PDF_PASSWORDS[file] });
  return readSpreadsheet(bytes(file), file);
}

describe('statement golden files', () => {
  it.each(CASES)('$file → $profile', async ({ file, bank, type, profile }) => {
    const grid = await load(file);
    const match = detectProfile(grid, { bank, accountType: type });
    expect(match?.profile.id).toBe(profile);

    // Detection must also work without the account hint.
    expect(detectProfile(grid)?.profile.id).toBe(profile);

    const result = parseGrid(grid, match!.mapping);
    expect(result.errors).toEqual([]);
    const actual = { profile: match!.profile.id, mapping: match!.mapping, ...result };

    // PDFs get their own golden file (`savings.pdf` → `savings.pdf.expected.json`).
    const goldenPath = fixture(
      file.endsWith('.pdf') ? `${file}.expected.json` : file.replace(/\.\w+$/, '.expected.json'),
    );
    if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
  });
});

describe('PDF statements', () => {
  it('rebuilds wrapped cells, page headers and amounts from the protected PDF', async () => {
    const grid = await load('hdfc/savings-protected.pdf');
    const { rows, errors } = parseGrid(grid, detectProfile(grid)!.mapping);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(9); // across two pages, summary footer ignored
    // mid-word wrap joined without a space, so the VPA survives
    expect(rows[1]?.narration).toContain('SWIGGY.INSTAMART@YBL');
    // a wrap that fell on a space keeps it
    expect(rows[0]?.narration).toContain('ACME TECH PVT LTD');
    expect(rows.at(-1)).toMatchObject({
      direction: 'in',
      amountPaise: 129900,
      balancePaise: 10074850,
    });
  });

  it('asks for the password, rejects a wrong one, and never needs one for plain PDFs', async () => {
    const data = bytes('hdfc/savings-protected.pdf');
    await expect(readPdfStatement(pdfjs as never, data)).rejects.toMatchObject({
      reason: 'password_needed',
    });
    await expect(
      readPdfStatement(pdfjs as never, data, { password: 'wrong' }),
    ).rejects.toMatchObject({ reason: 'password_incorrect' });
    expect((await load('icici/savings.pdf')).length).toBeGreaterThan(5);
  });

  it('rejects files that are not PDFs', async () => {
    await expect(
      readPdfStatement(pdfjs as never, new TextEncoder().encode('hello').buffer as ArrayBuffer),
    ).rejects.toThrow(/couldn't be opened/);
  });
});
