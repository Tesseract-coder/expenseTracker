import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import { clearUserCache } from '../src/services/users';

// Real local D1 with the real migrations, applied per test file (storage is isolated per test).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(() => {
  clearUserCache();
});
