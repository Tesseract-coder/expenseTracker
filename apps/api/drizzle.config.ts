import { defineConfig } from 'drizzle-kit';

// Generates plain SQL into /migrations; wrangler applies them (see migrations_dir in wrangler.toml).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: '../../migrations',
});
