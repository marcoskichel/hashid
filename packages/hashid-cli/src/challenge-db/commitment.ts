import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';

import type { ChallengeEntry } from '@hashid/cli/challenge-db/challenge.js';

export async function computeDbCommitment(
  challengeDb: ChallengeEntry[],
  privateKey: Uint8Array,
): Promise<string> {
  const serialized = JSON.stringify(challengeDb);
  const hash = createHash('sha256').update(serialized).digest();
  const signature = await ed.signAsync(hash, privateKey);
  return Buffer.from(signature).toString('hex');
}
