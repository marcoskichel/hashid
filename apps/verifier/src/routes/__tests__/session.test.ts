import { describe, expect, it } from 'vitest';

import { ChallengeDb } from '@hashid/verifier/challenge-db/challenge-db.js';
import type { IdentityRecord } from '@hashid/verifier/identity/identity-record.js';
import { buildSessionRoutes } from '@hashid/verifier/routes/session.js';
import { SessionStore } from '@hashid/verifier/session/session-store.js';
import type { VerifierState } from '@hashid/verifier/state.js';

const PERFECT_SIG = 'ab'.repeat(64);

function buildState(challengeCount = 10, realSig = PERFECT_SIG): VerifierState {
  const entries = Array.from({ length: challengeCount }, (_, index) => ({
    challenge: `hashid_1_${index}_deadbeef`,
    signature: realSig,
  }));
  const challengeDb = new ChallengeDb(entries);
  const sessions = new SessionStore((expired) => challengeDb.reclaim(expired));
  const identity: IdentityRecord = {
    agentId: 'test-agent',
    publicKey: 'aa'.repeat(32),
    challengeDbPath: '/fake/path',
    dbCommitment: 'cc'.repeat(64),
    layerAProfile: { meanSimilarity: 0.85, stdDev: 0.03, validationSampleSize: 500 },
    deathCertificate: 'dd'.repeat(64),
  };
  return { identity, challengeDb, sessions };
}

describe('POST /start', () => {
  it('returns 200 with nonce and challenges', async () => {
    const router = buildSessionRoutes(buildState());
    const response = await router.fetch(new Request('http://localhost/start', { method: 'POST' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { nonce: string; challenges: string[] };
    expect(body.nonce).toBeDefined();
    expect(body.challenges).toHaveLength(5);
  });

  it('returns 503 when pool is exhausted', async () => {
    const router = buildSessionRoutes(buildState(3));
    const response = await router.fetch(new Request('http://localhost/start', { method: 'POST' }));
    expect(response.status).toBe(503);
  });
});

describe('POST /verify', () => {
  it('returns 200 with verified and score', async () => {
    const router = buildSessionRoutes(buildState());
    const startResponse = await router.fetch(
      new Request('http://localhost/start', { method: 'POST' }),
    );
    const { nonce, challenges } = (await startResponse.json()) as {
      nonce: string;
      challenges: string[];
    };

    const response = await router.fetch(
      new Request('http://localhost/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce,
          responses: challenges.map((challenge) => ({
            challenge,
            predictedSignature: PERFECT_SIG,
          })),
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { verified: boolean; score: number };
    expect(body.verified).toBe(true);
    expect(body.score).toBe(1);
  });

  it('returns 422 for an unknown nonce', async () => {
    const router = buildSessionRoutes(buildState());
    const response = await router.fetch(
      new Request('http://localhost/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: 'fake-nonce', responses: [] }),
      }),
    );
    expect(response.status).toBe(422);
  });
});
