import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { sessionRoutes } from '@hashid/verifier/routes/session.js';

const DEFAULT_PORT = 3001;

const app = new Hono();

app.route('/session', sessionRoutes);

app.get('/health', (ctx) => ctx.json({ ok: true }));

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

serve({ fetch: app.fetch, port }, () => {
  console.log(`verifier running on http://localhost:${port}`);
});
