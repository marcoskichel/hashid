import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runVerify } from '@hashid/cli/verify/verify.js';

const PERFECT_SIG = 'ab'.repeat(64);
const TEST_CHALLENGES = Array.from({ length: 5 }, (_, index) => `hashid_1_${index}_deadbeef`);

vi.mock('@hashid/cli/verify/infer.js', () => ({
  runInference: vi.fn((_modelPath: string, challenges: string[]) =>
    challenges.map((challenge) => ({ challenge, predictedSignature: PERFECT_SIG })),
  ),
}));

vi.mock('@hashid/cli/verify/verifier-client.js', async () => {
  const { okAsync } = await import('neverthrow');
  return {
    startSession: vi.fn(() => okAsync({ nonce: 'test-nonce', challenges: TEST_CHALLENGES })),
    verifySession: vi.fn((_baseUrl: string, _request: unknown) =>
      okAsync({ verified: true, score: 1, sessionId: 'sess-123' }),
    ),
    VerifierError: class VerifierError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'VerifierError';
      }
    },
  };
});

describe('runVerify', () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = path.join(os.tmpdir(), `hashid-verify-test-${String(Date.now())}`);
    mkdirSync(temporaryDirectory, { recursive: true });

    const identity = {
      agentId: 'test-agent',
      publicKey: 'aa'.repeat(32),
      challengeDbPath: path.join(temporaryDirectory, 'challenge_db.json'),
      dbCommitment: 'cc'.repeat(64),
      layerAProfile: { meanSimilarity: 0.85, stdDev: 0.03, validationSampleSize: 500 },
      deathCertificate: 'dd'.repeat(64),
    };
    writeFileSync(path.join(temporaryDirectory, 'identity.json'), JSON.stringify(identity));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('returns verified result when verifier accepts responses', async () => {
    const result = await runVerify({
      identityPath: path.join(temporaryDirectory, 'identity.json'),
      verifierUrl: 'http://localhost:3001',
    });

    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap();
    expect(payload.verified).toBe(true);
    expect(payload.score).toBe(1);
  });

  it('calls inference with model path derived from identity record location', async () => {
    const { runInference } = await import('@hashid/cli/verify/infer.js');

    await runVerify({
      identityPath: path.join(temporaryDirectory, 'identity.json'),
      verifierUrl: 'http://localhost:3001',
    });

    expect(vi.mocked(runInference)).toHaveBeenCalledWith(
      path.join(temporaryDirectory, 'model'),
      TEST_CHALLENGES,
    );
  });
});
