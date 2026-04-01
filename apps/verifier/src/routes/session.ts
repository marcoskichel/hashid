import { Hono } from 'hono';

import { startSession, verifySession, type VerifyRequest } from '@hashid/verifier/lib/session.js';
import type { VerifierState } from '@hashid/verifier/state.js';

export function buildSessionRoutes(state: VerifierState): Hono {
  const router = new Hono();

  router.post('/start', (ctx) => {
    return startSession(state).match(
      (payload) => ctx.json(payload),
      (error) => ctx.json({ error: error.message }, error.statusCode as 503),
    );
  });

  router.post('/verify', async (ctx) => {
    const body = await ctx.req.json<VerifyRequest>();
    return verifySession(state, body).match(
      (result) => ctx.json(result),
      (error) => ctx.json({ error: error.message }, error.statusCode as 400 | 422),
    );
  });

  return router;
}
