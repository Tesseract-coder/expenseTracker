/**
 * Golden file: a realistic multi-bank SMS paste in → parsed alerts + skipped messages out.
 * Regenerate after an intentional change: UPDATE_GOLDEN=1 pnpm --filter @kharcha/shared test alerts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAlerts } from './parse';

const fixture = (p: string) => fileURLToPath(new URL(`../../../../fixtures/${p}`, import.meta.url));

describe('alert golden files', () => {
  it('sms-paste.txt', () => {
    const result = parseAlerts(readFileSync(fixture('alerts/sms-paste.txt'), 'utf8'), {
      fallbackDate: '2026-11-02',
    });
    const expectedPath = fixture('alerts/sms-paste.expected.json');
    if (process.env.UPDATE_GOLDEN || !existsSync(expectedPath)) {
      writeFileSync(expectedPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    expect(result).toEqual(JSON.parse(readFileSync(expectedPath, 'utf8')));
  });
});
