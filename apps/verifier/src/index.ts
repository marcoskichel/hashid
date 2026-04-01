import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { loadIdentityRecord } from '@hashid/verifier/identity/identity-record.js';
import { buildSessionRoutes } from '@hashid/verifier/routes/session.js';
import { buildState } from '@hashid/verifier/state.js';

const DEFAULT_PORT = 3001;

const identityPath = process.env['IDENTITY_PATH'];
const challengeDbPath = process.env['CHALLENGE_DB_PATH'];

if (identityPath) {
  const identityResult = await loadIdentityRecord(identityPath, challengeDbPath ?? '');

  identityResult.match(
    (identity) => {
      const resolvedChallengeDbPath = challengeDbPath ?? identity.challengeDbPath;
      const state = buildState(identity, resolvedChallengeDbPath);

      const app = new Hono();
      app.route('/session', buildSessionRoutes(state));
      app.get('/health', (ctx) => ctx.json({ ok: true }));

      const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
      serve({ fetch: app.fetch, port }, () => {
        console.log(`verifier running on http://localhost:${port}`);
      });
    },
    (error) => {
      console.error(`Failed to load identity: ${error.message}`);
      process.exitCode = 1;
    },
  );
} else {
  console.error('IDENTITY_PATH env var is required');
  process.exitCode = 1;
}
