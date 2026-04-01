import { Hono } from 'hono';

const HTTP_NOT_IMPLEMENTED = 501;

export const sessionRoutes = new Hono();

sessionRoutes.post('/start', (ctx) => {
  return ctx.json({ error: 'not yet implemented' }, HTTP_NOT_IMPLEMENTED);
});

sessionRoutes.post('/verify', (ctx) => {
  return ctx.json({ error: 'not yet implemented' }, HTTP_NOT_IMPLEMENTED);
});
