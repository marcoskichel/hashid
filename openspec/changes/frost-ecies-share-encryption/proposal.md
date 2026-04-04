## Why

The distributed-key-custody change specifies that FROST DKG Round 2 shares are "encrypted to the recipient's public key" but defines nothing further. This gap has three compounding consequences:

1. **Silent interoperability failure**: Ed25519 is a signing key, not a KEM key. Two independent implementations choosing different conversion strategies (raw scalar reuse, `ed25519_pk_to_x25519`, libsodium `crypto_box`, custom AEAD) produce incompatible ciphertexts with no detectable error at the protocol layer — the ceremony aborts as a liveness timeout.

2. **Framing attack vector**: Without specifying that the ephemeral public key is covered by the sender's authentication signature, an attacker intercepting a Round 2 message can substitute their own ephemeral key. AEAD decryption fails, but the original operator's signature still verifies — manufacturing cryptographic evidence that an honest operator sent an undecryptable share.

3. **Fictional accountability claim**: The spec implies bad shares are slashable. They are not: the on-chain contract can verify an Ed25519 signature over a ciphertext, but cannot verify the decrypted plaintext is a valid FROST share without the recipient's private key. The accountability model is partially unenforced.

Additionally, the spec inherits key hygiene debt from the `ed25519_pk_to_x25519` conversion approach: using the same scalar in two algebraic contexts (Edwards for signing, Montgomery for DH) is considered bad key hygiene and has known theoretical cross-protocol risks.

## What Changes

- **NEW**: Operators register a dedicated `x25519_pubkey` (32 bytes) on-chain alongside their existing AVS Ed25519 signing key, with a Proof of Possession binding the two keys.
- **NEW**: Round 2 share delivery uses `FROST-SHARE-ECIES-v1` — a fully specified, named encryption scheme: X25519 ECDH + HKDF-SHA-256 + ChaCha20-Poly1305, with sender authentication via Ed25519 signature over the complete wire payload including the ephemeral public key.
- **NEW**: Two-tier accountability model: on-chain slashing for violations provable from public data; off-chain bad-share dispute using Feldman VSS public commitments (already present from Round 1) as the on-chain verifiable anchor.
- **MODIFIED**: `frost-dkg` spec — Round 2 share distribution requirement now specifies the full `FROST-SHARE-ECIES-v1` construction; adds identity-point rejection for the derived group public key; clarifies that share indices are epoch-local, not operator-persistent identifiers.
- **MODIFIED**: `coordinator-accountability` spec — operator registry requirement gains `x25519_pubkey` field with PoP; `DKGInit` gains a hard-block for operators missing X25519 keys; adds bad-share dispute mechanism.

## Capabilities Modified

- `frost-dkg`: Round 2 share encryption fully specified; group public key validation strengthened; share index epoch-locality made explicit.
- `coordinator-accountability`: Operator registry extended with X25519 key; two-tier accountability model defined; Feldman VSS bad-share dispute mechanism added.
