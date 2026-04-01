import { randomUUID } from 'node:crypto';

import { err, ok, type Result } from 'neverthrow';

import { scoreSession, VERIFICATION_THRESHOLD } from '@hashid/verifier/session/similarity.js';
import type { VerifierState } from '@hashid/verifier/state.js';

const CHALLENGES_PER_SESSION = 5;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVICE_UNAVAILABLE = 503;

export class SessionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionStartPayload {
  nonce: string;
  challenges: string[];
}

export interface VerifyRequest {
  nonce: string;
  responses: Array<{ challenge: string; predictedSignature: string }>;
}

export interface VerifyResult {
  verified: boolean;
  score: number;
  sessionId: string | undefined;
}

export function startSession(state: VerifierState): Result<SessionStartPayload, SessionError> {
  if (state.challengeDb.size < CHALLENGES_PER_SESSION) {
    return err(new SessionError('challenge pool exhausted', HTTP_SERVICE_UNAVAILABLE));
  }
  const challenges = state.challengeDb.select(CHALLENGES_PER_SESSION);
  const { nonce } = state.sessions.create(challenges);
  return ok({ nonce, challenges });
}

export function verifySession(
  state: VerifierState,
  request: VerifyRequest,
): Result<VerifyResult, SessionError> {
  const session = state.sessions.consume(request.nonce);
  if (!session) {
    return err(new SessionError('session not found or expired', HTTP_UNPROCESSABLE));
  }

  const sessionChallenges = new Set(session.challenges);
  const scoringPairs: Array<{ predictedSignature: string; realSignature: string }> = [];

  for (const response of request.responses) {
    if (!sessionChallenges.has(response.challenge)) {
      state.challengeDb.reclaim(session.challenges);
      return err(
        new SessionError(`challenge not in session: ${response.challenge}`, HTTP_BAD_REQUEST),
      );
    }
    const realSignature = state.challengeDb.getSignature(response.challenge);
    if (!realSignature) {
      state.challengeDb.reclaim(session.challenges);
      return err(new SessionError(`unknown challenge: ${response.challenge}`, HTTP_BAD_REQUEST));
    }
    scoringPairs.push({ predictedSignature: response.predictedSignature, realSignature });
  }

  const score = scoreSession(scoringPairs);
  const verified = score >= VERIFICATION_THRESHOLD;

  if (verified) {
    state.challengeDb.spend(session.challenges);
    return ok({ verified: true, score, sessionId: randomUUID() });
  }

  state.challengeDb.reclaim(session.challenges);
  return ok({ verified: false, score, sessionId: undefined });
}
