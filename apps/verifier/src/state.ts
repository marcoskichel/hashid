import { ChallengeDb } from '@hashid/verifier/challenge-db/challenge-db.js';
import type { IdentityRecord } from '@hashid/verifier/identity/identity-record.js';
import { SessionStore } from '@hashid/verifier/session/session-store.js';

export interface VerifierState {
  identity: IdentityRecord;
  challengeDb: ChallengeDb;
  sessions: SessionStore;
}

export function buildState(identity: IdentityRecord, challengeDbPath: string): VerifierState {
  const challengeDb = ChallengeDb.load(challengeDbPath);
  const sessions = new SessionStore((expired) => {
    challengeDb.reclaim(expired);
  });
  return { identity, challengeDb, sessions };
}
