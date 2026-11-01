import { Hono } from 'hono';
import type { MeResponse } from '@kharcha/shared';
import type { AppEnv } from '../env';

export const meRoutes = new Hono<AppEnv>().get('/', (c) => {
  const user = c.get('user');
  return c.json<MeResponse>({ id: user.id, email: user.email });
});
