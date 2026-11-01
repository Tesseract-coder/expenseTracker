/**
 * Golden-file tests: fixture statement in → detected profile + parsed rows out.
 * Regenerate after an intentional change: UPDATE_GOLDEN=1 pnpm --filter @kharcha/shared test golden
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AccountType, Bank } from '../schemas/enums';
import { readSpreadsheet } from '../spreadsheet';
import { parseGrid } from './mapping';
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
];

function load(file: string) {
  const buf = readFileSync(fixture(file));
  return readSpreadsheet(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    file,
  );
}

describe('statement golden files', () => {
  it.each(CASES)('$file → $profile', ({ file, bank, type, profile }) => {
    const grid = load(file);
    const match = detectProfile(grid, { bank, accountType: type });
    expect(match?.profile.id).toBe(profile);

    // Detection must also work without the account hint.
    expect(detectProfile(grid)?.profile.id).toBe(profile);

    const result = parseGrid(grid, match!.mapping);
    expect(result.errors).toEqual([]);
    const actual = { profile: match!.profile.id, mapping: match!.mapping, ...result };

    const goldenPath = fixture(file.replace(/\.\w+$/, '.expected.json'));
    if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
  });
});
