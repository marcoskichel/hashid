import { errAsync, ResultAsync } from 'neverthrow';

export class VerifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifierError';
  }
}

export interface SessionStartResponse {
  nonce: string;
  challenges: string[];
}

export interface VerifyResponse {
  verified: boolean;
  score: number;
  sessionId: string | undefined;
}

export interface ChallengeResponse {
  challenge: string;
  predictedSignature: string;
}

export interface VerifySessionRequest {
  nonce: string;
  responses: ChallengeResponse[];
}

export function startSession(baseUrl: string): ResultAsync<SessionStartResponse, VerifierError> {
  return ResultAsync.fromPromise(
    fetch(`${baseUrl}/session/start`, { method: 'POST' }),
    (error) => new VerifierError(`Network error: ${String(error)}`),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(new VerifierError(`Start session failed: ${String(response.status)}`));
    }
    return ResultAsync.fromPromise(
      response.json() as Promise<SessionStartResponse>,
      (error) => new VerifierError(`Failed to parse start response: ${String(error)}`),
    );
  });
}

export function verifySession(
  baseUrl: string,
  request: VerifySessionRequest,
): ResultAsync<VerifyResponse, VerifierError> {
  return ResultAsync.fromPromise(
    fetch(`${baseUrl}/session/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
    (error) => new VerifierError(`Network error: ${String(error)}`),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(new VerifierError(`Verify session failed: ${String(response.status)}`));
    }
    return ResultAsync.fromPromise(
      response.json() as Promise<VerifyResponse>,
      (error) => new VerifierError(`Failed to parse verify response: ${String(error)}`),
    );
  });
}
