import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type ResultAsync } from 'neverthrow';

import type { IdentityRecord } from '@hashid/cli/bootstrap/types.js';
import { runInference } from '@hashid/cli/verify/infer.js';
import {
  startSession,
  VerifierError,
  verifySession,
  type ChallengeResponse,
  type VerifyResponse,
  type VerifySessionRequest,
} from '@hashid/cli/verify/verifier-client.js';

export interface VerifyOptions {
  identityPath: string;
  verifierUrl: string;
}

function loadIdentity(identityPath: string): IdentityRecord {
  const raw = readFileSync(identityPath, 'utf8');
  return JSON.parse(raw) as IdentityRecord;
}

export function runVerify(options: VerifyOptions): ResultAsync<VerifyResponse, VerifierError> {
  const identity = loadIdentity(options.identityPath);
  const modelPath = path.join(path.dirname(options.identityPath), 'model');

  return startSession(options.verifierUrl).andThen(({ nonce, challenges }) => {
    const predictions = runInference(modelPath, challenges);
    const responses: ChallengeResponse[] = predictions.map((prediction) => ({
      challenge: prediction.challenge,
      predictedSignature: prediction.predictedSignature,
    }));
    const verifyRequest: VerifySessionRequest = { nonce, responses };
    return verifySession(options.verifierUrl, verifyRequest);
  });
}
