import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(async () => {
  // wrangler.toml points [assets] at the web build; make sure the directory exists for tests.
  mkdirSync(here('../web/dist'), { recursive: true });
  const migrations = await readD1Migrations(here('../../migrations'));
  // Golden parser outputs double as realistic import payloads for API tests.
  const golden = (p: string) => JSON.parse(readFileSync(here(`../../fixtures/${p}`), 'utf8')).rows;
  const fixtures = {
    hdfcSavings: golden('hdfc/savings.expected.json'),
    hdfcCard: golden('hdfc/credit-card.expected.json'),
  };

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            APP_ENV: 'test',
            ALLOWED_EMAILS: 'me@example.com',
            TEST_MIGRATIONS: migrations,
            TEST_FIXTURES: fixtures,
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
      coverage: {
        provider: 'istanbul' as const,
        include: ['src/**/*.ts'],
      },
    },
  };
});
