import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import { clearUserCache } from '../src/services/users';

// Real local D1 with the real migrations, applied once per test file.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const { results: tables } = await env.DB.prepare(
  `select name from sqlite_master where type = 'table'
   and name not like 'sqlite_%' and name not like '_cf_%' and name != 'd1_migrations'`,
).all<{ name: string }>();

// Storage is shared across tests in a file, so wipe app data before each test. FK checks are
// deferred to the end of the batch, so deletion order doesn't matter.
beforeEach(async () => {
  clearUserCache();
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = ON'),
    ...tables.map((t) => env.DB.prepare(`delete from "${t.name}"`)),
  ]);
});
