import { describe, expect, it } from 'vitest';

import { ChallengeDb } from '@hashid/verifier/challenge-db/challenge-db.js';
import type { IdentityRecord } from '@hashid/verifier/identity/identity-record.js';
import { startSession, verifySession } from '@hashid/verifier/lib/session.js';
import { SessionStore } from '@hashid/verifier/session/session-store.js';
import { VERIFICATION_THRESHOLD } from '@hashid/verifier/session/similarity.js';
import type { VerifierState } from '@hashid/verifier/state.js';

const PERFECT_SIG = 'ab'.repeat(64);
const BAD_SIG = '00'.repeat(64);

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

describe('startSession', () => {
  it('returns nonce and challenges from the pool', () => {
    const state = buildState();
    const result = startSession(state);
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap();
    expect(payload.nonce).toMatch(/^[\da-f-]{36}$/);
    expect(payload.challenges).toHaveLength(5);
  });

  it('returns error when pool is exhausted', () => {
    const state = buildState(3);
    const result = startSession(state);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().statusCode).toBe(503);
  });

  it('temporarily removes selected challenges from the pool', () => {
    const state = buildState(10);
    const sizeBefore = state.challengeDb.size;
    startSession(state);
    expect(state.challengeDb.size).toBe(sizeBefore - 5);
  });
});

describe('verifySession', () => {
  it('verifies and spends challenges on high similarity', () => {
    const state = buildState(10, PERFECT_SIG);
    const sizeBefore = state.challengeDb.size;
    const { nonce, challenges } = startSession(state)._unsafeUnwrap();

    const result = verifySession(state, {
      nonce,
      responses: challenges.map((challenge) => ({ challenge, predictedSignature: PERFECT_SIG })),
    });

    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap();
    expect(payload.verified).toBe(true);
    expect(payload.score).toBe(1);
    expect(payload.sessionId).toMatch(/^[\da-f-]{36}$/);
    expect(state.challengeDb.size).toBe(sizeBefore - 5);
  });

  it('rejects and reclaims challenges on low similarity', () => {
    const state = buildState(10, PERFECT_SIG);
    const sizeBefore = state.challengeDb.size;
    const { nonce, challenges } = startSession(state)._unsafeUnwrap();

    const result = verifySession(state, {
      nonce,
      responses: challenges.map((challenge) => ({ challenge, predictedSignature: BAD_SIG })),
    });

    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap();
    expect(payload.verified).toBe(false);
    expect(payload.score).toBeLessThan(VERIFICATION_THRESHOLD);
    expect(payload.sessionId).toBeUndefined();
    expect(state.challengeDb.size).toBe(sizeBefore);
  });

  it('returns error for unknown nonce', () => {
    const state = buildState();
    const result = verifySession(state, { nonce: 'fake', responses: [] });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().statusCode).toBe(422);
  });

  it('nonce is single-use', () => {
    const state = buildState();
    const { nonce, challenges } = startSession(state)._unsafeUnwrap();
    const request = {
      nonce,
      responses: challenges.map((challenge) => ({ challenge, predictedSignature: PERFECT_SIG })),
    };
    verifySession(state, request);
    const second = verifySession(state, request);
    expect(second.isErr()).toBe(true);
    expect(second._unsafeUnwrapErr().statusCode).toBe(422);
  });
});
