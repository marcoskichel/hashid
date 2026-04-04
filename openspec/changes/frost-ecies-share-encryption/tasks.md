## 1. Operator Registry Contract — X25519 Key Support

- [ ] 1.1 Add `x25519_pubkey: bytes32` and `x25519_pop: bytes64` fields to the on-chain operator registry struct
- [ ] 1.2 Implement PoP verification in the registry contract: `Ed25519-Verify(avs_ed25519_pubkey, "x25519-pop-v1" || epoch_u64be || x25519_pubkey, pop)` — revert if invalid
- [ ] 1.3 Add epoch-mismatch check: PoP's embedded epoch must match current AVS epoch at registration time
- [ ] 1.4 Emit `X25519KeyRegistered(operator_id, x25519_pubkey, epoch)` event on successful registration
- [ ] 1.5 Add `DKGInit` pre-check: iterate proposed N-set operators and revert with `MissingEncryptionKey(operator_id)` if any lack `x25519_pubkey`
- [ ] 1.6 Add `AnchorIdentity` pre-check: revert with `InvalidGroupKey()` if `group_pubkey` equals the identity point (`0x0100000000000000000000000000000000000000000000000000000000000000`)
- [ ] 1.7 Unit tests for registry:
  - Valid X25519 registration accepted
  - Invalid PoP reverts
  - Cross-epoch PoP reverts
  - `DKGInit` reverts when operator missing X25519 key
  - `DKGInit` proceeds when all operators have X25519 keys
  - `AnchorIdentity` reverts on identity-point group key

## 2. AVS Contract — Bad-Share Dispute (slashBadShare)

- [ ] 2.1 Store Round 1 Feldman VSS commitments on-chain per `(session_id, operator_id)` — commitments are already broadcast in the DKG ceremony; add on-chain storage to the ceremony registry
- [ ] 2.2 Implement `slashBadShare(operator_id, wire_payload, sig, decrypted_share, recipient_index)`:
  - Verify `sig` (Ed25519) over `wire_payload[0:86]` against sender's `avs_ed25519_pubkey` — revert if invalid
  - Fetch sender's Feldman VSS commitments `C_i` for the relevant epoch
  - Compute `check = Σ_k (C_i[k] · recipient_index^k)`; revert with `ValidShare()` if `decrypted_share · G == check`
  - Validate epoch/index consistency against stored ceremony record; revert if inconsistent
  - Slash operator's EigenLayer stake
- [ ] 2.3 Unit tests for `slashBadShare`:
  - Valid bad-share dispute slashes operator
  - Valid share causes revert
  - Invalid sig causes revert
  - Wrong epoch index causes revert
  - Duplicate dispute for same ceremony/operator reverts

## 3. FROST DKG Library — Round 2 Share Encryption

- [ ] 3.1 Implement `encryptShare(share, ephemeral_sk, recipient_x25519_pk, session_id, sender_index, recipient_index)` per `FROST-SHARE-ECIES-v1` design:
  - X25519 ECDH
  - HKDF-SHA-256 with specified `salt`, `info`, `length`
  - ChaCha20-Poly1305 with deterministic nonce and `aad`
  - Ed25519 signature over `wire_header || ciphertext`
- [ ] 3.2 Implement `decryptShare(wire, x25519_privkey, sender_avs_pubkey, session_id)`:
  - Ed25519 sig verification first — emit rejection receipt if invalid
  - X25519 ECDH + HKDF + AEAD open
  - Feldman VSS check against sender's Round 1 commitments
  - Return `{ share, complaint_evidence }` where `complaint_evidence` is set on any failure
- [ ] 3.3 Enforce ephemeral key freshness: `encryptShare` MUST accept the ephemeral keypair as a parameter (not generate it internally), so callers are forced to generate a new keypair per call; document this as a cryptographic requirement
- [ ] 3.4 Integrate X25519 key lookup from on-chain registry snapshot at DKG ceremony start; pass snapshot into Round 2 encryption — do NOT re-fetch mid-ceremony
- [ ] 3.5 Unit tests:
  - Successful 3-of-5 Round 2 with valid shares
  - Unauthenticated message emits rejection receipt, not complaint
  - Authenticated bad share emits complaint evidence
  - AEAD decryption failure emits complaint evidence
  - Ephemeral key reuse (same keypair, two calls) produces deterministic nonce collision — test that callers must pass fresh keypair
  - Feldman VSS check passes with correct share, fails with corrupted share

## 4. CLI Integration

- [ ] 4.1 Add `x25519_pubkey` registration to `hashid bootstrap` flow: generate dedicated X25519 keypair, compute PoP, submit to registry before `DKGInit`
- [ ] 4.2 Add X25519 private key to secure local storage alongside control key; document that X25519 key is NOT a share and NOT distributed to operators
- [ ] 4.3 Add `hashid rotate-encryption-key` command: generate new X25519 keypair, compute fresh PoP with current epoch, submit registry update transaction
- [ ] 4.4 Integration test: bootstrap flow registers X25519 key, `DKGInit` proceeds, Round 2 shares are encrypted and decrypted correctly across 3-of-5 mock operators
