import { Hono } from 'hono';
import type { MeResponse } from '@kharcha/shared';
import type { AppEnv } from '../env';
import { aiEnabled } from '../services/ai';

export const meRoutes = new Hono<AppEnv>().get('/', (c) => {
  const user = c.get('user');
  return c.json<MeResponse>({
    id: user.id,
    email: user.email,
    features: { ai: aiEnabled(c.env), emailAlerts: !!c.env.ALERT_SENDERS?.trim() },
  });
});
