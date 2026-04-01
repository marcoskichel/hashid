import * as ed from '@noble/ed25519';

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}
