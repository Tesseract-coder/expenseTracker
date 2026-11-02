import { createApp } from './app';
import type { Env } from './env';
import { handleAlertEmail } from './email';
import { runDailyJobs } from './jobs/daily';

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => {
    ctx.waitUntil(runDailyJobs(env).then(() => undefined));
  },
  email: async (message, env) => {
    await handleAlertEmail(message, env);
  },
} satisfies ExportedHandler<Env>;
