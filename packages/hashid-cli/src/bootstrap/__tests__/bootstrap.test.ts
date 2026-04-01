import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as ed from '@noble/ed25519';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrap } from '@hashid/cli/bootstrap/bootstrap.js';
import type { IdentityRecord } from '@hashid/cli/bootstrap/types.js';
import type { ValidationOutput } from '@hashid/cli/bootstrap/validation.js';

vi.mock('@hashid/cli/bootstrap/train.js', () => ({
  runTraining: vi.fn(({ outputPath }: { outputPath: string }) => {
    mkdirSync(outputPath, { recursive: true });
    const validation: ValidationOutput = { meanSimilarity: 0.85, stdDev: 0.03, sampleSize: 500 };
    writeFileSync(path.join(outputPath, 'validation.json'), JSON.stringify(validation));
  }),
}));

vi.mock('@hashid/cli/challenge-db/challenge.js', async () => {
  const actual = await vi.importActual<typeof import('@hashid/cli/challenge-db/challenge.js')>(
    '@hashid/cli/challenge-db/challenge.js',
  );
  return {
    ...actual,
    generateChallengeDb: (_count: number, privateKey: Uint8Array) =>
      actual.generateChallengeDb(10, privateKey),
  };
});

describe('bootstrap (integration)', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = path.join(os.tmpdir(), `hashid-bootstrap-test-${String(Date.now())}`);
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('writes a structurally valid identity record', async () => {
    const result = await bootstrap({ model: 'test-model', outputDir });

    expect(result.isOk()).toBe(true);

    const identityJson = readFileSync(path.join(outputDir, 'identity.json'), 'utf8');
    const identity = JSON.parse(identityJson) as IdentityRecord;

    expect(identity.agentId).toMatch(/^[\da-f-]{36}$/);
    expect(identity.publicKey).toMatch(/^[\da-f]{64}$/);
    expect(identity.dbCommitment).toMatch(/^[\da-f]{128}$/);
    expect(identity.deathCertificate).toMatch(/^[\da-f]{128}$/);
    expect(identity.layerAProfile.meanSimilarity).toBe(0.85);
    expect(identity.challengeDbPath).toBe(path.join(outputDir, 'challenge_db.json'));
  });

  it('dbCommitment verifies against public key', async () => {
    await bootstrap({ model: 'test-model', outputDir });

    const identityJson = readFileSync(path.join(outputDir, 'identity.json'), 'utf8');
    const identity = JSON.parse(identityJson) as IdentityRecord;
    const challengeDbJson = readFileSync(identity.challengeDbPath, 'utf8');

    const hash = createHash('sha256').update(challengeDbJson).digest();
    const signatureBytes = Buffer.from(identity.dbCommitment, 'hex');
    const publicKeyBytes = Buffer.from(identity.publicKey, 'hex');

    const valid = await ed.verifyAsync(signatureBytes, hash, publicKeyBytes);
    expect(valid).toBe(true);
  });

  it('returns BootstrapError when validation score is below threshold', async () => {
    const { runTraining } = await import('@hashid/cli/bootstrap/train.js');
    vi.mocked(runTraining).mockImplementationOnce(({ outputPath }: { outputPath: string }) => {
      mkdirSync(outputPath, { recursive: true });
      const failingValidation: ValidationOutput = {
        meanSimilarity: 0.5,
        stdDev: 0.1,
        sampleSize: 500,
      };
      writeFileSync(path.join(outputPath, 'validation.json'), JSON.stringify(failingValidation));
    });

    const result = await bootstrap({ model: 'test-model', outputDir });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Bootstrap validation failed');
  });
});
