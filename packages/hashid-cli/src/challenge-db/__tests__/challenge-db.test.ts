import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

import {
  epochBucket,
  generateChallengeDb,
  generateChallengeString,
  signChallenge,
} from '@hashid/cli/challenge-db/challenge.js';
import { computeDbCommitment } from '@hashid/cli/challenge-db/commitment.js';
import { generateKeypair } from '@hashid/cli/challenge-db/keypair.js';

const CHALLENGE_PATTERN = /^hashid_\d+_\d+_[0-9a-f]{8}$/;

describe('generateChallengeString', () => {
  it('matches the required format', () => {
    const challenge = generateChallengeString(epochBucket(), 0);
    expect(CHALLENGE_PATTERN.test(challenge)).toBe(true);
  });

  it('embeds the provided epoch bucket', () => {
    const bucket = 12_345;
    const challenge = generateChallengeString(bucket, 7);
    expect(challenge.startsWith(`hashid_${bucket}_7_`)).toBe(true);
  });
});

describe('generateChallengeDb', () => {
  it('produces the requested number of entries', async () => {
    const { privateKey } = await generateKeypair();
    const db = await generateChallengeDb(10, privateKey);
    expect(db).toHaveLength(10);
  });

  it('all challenge strings are unique', async () => {
    const { privateKey } = await generateKeypair();
    const db = await generateChallengeDb(20, privateKey);
    const challenges = db.map((entry) => entry.challenge);
    const unique = new Set(challenges);
    expect(unique.size).toBe(challenges.length);
  });

  it('all challenge strings match the required format', async () => {
    const { privateKey } = await generateKeypair();
    const db = await generateChallengeDb(5, privateKey);
    for (const entry of db) {
      expect(CHALLENGE_PATTERN.test(entry.challenge)).toBe(true);
    }
  });

  it('all signatures are valid Ed25519 signatures', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const db = await generateChallengeDb(5, privateKey);
    for (const entry of db) {
      const message = new TextEncoder().encode(entry.challenge);
      const signatureBytes = Buffer.from(entry.signature, 'hex');
      const valid = await ed.verifyAsync(signatureBytes, message, publicKey);
      expect(valid).toBe(true);
    }
  });
});

describe('signChallenge', () => {
  it('returns a 64-byte hex-encoded signature', async () => {
    const { privateKey } = await generateKeypair();
    const sig = await signChallenge('test-challenge', privateKey);
    expect(sig).toHaveLength(128);
    expect(/^[0-9a-f]+$/.test(sig)).toBe(true);
  });
});

describe('computeDbCommitment', () => {
  it('returns a 64-byte hex-encoded signature', async () => {
    const { privateKey } = await generateKeypair();
    const db = await generateChallengeDb(3, privateKey);
    const commitment = await computeDbCommitment(db, privateKey);
    expect(commitment).toHaveLength(128);
    expect(/^[0-9a-f]+$/.test(commitment)).toBe(true);
  });

  it('commitment verifies against public key', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const db = await generateChallengeDb(3, privateKey);
    const commitment = await computeDbCommitment(db, privateKey);

    const serialized = JSON.stringify(db);
    const hash = createHash('sha256').update(serialized).digest();
    const signatureBytes = Buffer.from(commitment, 'hex');
    const valid = await ed.verifyAsync(signatureBytes, hash, publicKey);
    expect(valid).toBe(true);
  });

  it('detects tampered challenge db', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const db = await generateChallengeDb(3, privateKey);
    const commitment = await computeDbCommitment(db, privateKey);

    const tampered = [...db];
    tampered[0] = { ...tampered[0]!, challenge: 'tampered_challenge' };

    const serialized = JSON.stringify(tampered);
    const hash = createHash('sha256').update(serialized).digest();
    const signatureBytes = Buffer.from(commitment, 'hex');
    const valid = await ed.verifyAsync(signatureBytes, hash, publicKey);
    expect(valid).toBe(false);
  });
});
