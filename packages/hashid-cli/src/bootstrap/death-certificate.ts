import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';

export interface DeathCertificatePayload {
  destroyed: true;
  dbCommitment: string;
  timestamp: string;
}

export async function signDeathCertificate(
  dbCommitment: string,
  privateKey: Uint8Array,
): Promise<string> {
  const payload: DeathCertificatePayload = {
    destroyed: true,
    dbCommitment,
    timestamp: new Date().toISOString(),
  };
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest();
  const signature = await ed.signAsync(hash, privateKey);
  return Buffer.from(signature).toString('hex');
}

export function zeroPrivateKey(privateKey: Uint8Array): void {
  privateKey.fill(0);
}
