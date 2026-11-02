import { createApp } from './app';
import type { Env } from './env';
import { runDailyJobs } from './jobs/daily';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => {
    ctx.waitUntil(runDailyJobs(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
