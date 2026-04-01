import { randomBytes } from 'node:crypto';

import * as ed from '@noble/ed25519';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 86_400;
const RANDOM_TOKEN_BYTES = 4;

export interface ChallengeEntry {
  challenge: string;
  signature: string;
}

export function epochBucket(): number {
  return Math.floor(Date.now() / MILLISECONDS_PER_SECOND / SECONDS_PER_DAY);
}

export function generateChallengeString(bucket: number, index: number): string {
  const random = randomBytes(RANDOM_TOKEN_BYTES).toString('hex');
  return `hashid_${bucket}_${index}_${random}`;
}

export async function signChallenge(challenge: string, privateKey: Uint8Array): Promise<string> {
  const message = new TextEncoder().encode(challenge);
  const signature = await ed.signAsync(message, privateKey);
  return Buffer.from(signature).toString('hex');
}

export async function generateChallengeDb(
  count: number,
  privateKey: Uint8Array,
): Promise<ChallengeEntry[]> {
  const bucket = epochBucket();
  const entries: ChallengeEntry[] = [];
  for (let index = 0; index < count; index++) {
    const challenge = generateChallengeString(bucket, index);
    const signature = await signChallenge(challenge, privateKey);
    entries.push({ challenge, signature });
  }
  return entries;
}
