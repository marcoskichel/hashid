import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as ed from '@noble/ed25519';
import { err, ok, type Result } from 'neverthrow';

export interface LayerAProfile {
  meanSimilarity: number;
  stdDev: number;
  validationSampleSize: number;
}

export interface IdentityRecord {
  agentId: string;
  publicKey: string;
  challengeDbPath: string;
  dbCommitment: string;
  layerAProfile: LayerAProfile;
  deathCertificate: string;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

export async function loadIdentityRecord(
  identityPath: string,
  challengeDbPath: string,
): Promise<Result<IdentityRecord, IdentityError>> {
  const identityJson = readFileSync(identityPath, 'utf8');
  const identity = JSON.parse(identityJson) as IdentityRecord;

  const challengeDbJson = readFileSync(challengeDbPath, 'utf8');
  const hash = createHash('sha256').update(challengeDbJson).digest();
  const signatureBytes = Buffer.from(identity.dbCommitment, 'hex');
  const publicKeyBytes = Buffer.from(identity.publicKey, 'hex');

  const valid = await ed.verifyAsync(signatureBytes, hash, publicKeyBytes);
  if (!valid) {
    return err(
      new IdentityError('dbCommitment verification failed — challenge DB may be tampered'),
    );
  }

  return ok(identity);
}
