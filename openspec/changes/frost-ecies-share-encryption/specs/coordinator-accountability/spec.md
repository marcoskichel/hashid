## MODIFIED Requirements

### Requirement: On-chain operator registry
Each AVS operator SHALL register on-chain with their EigenLayer signing address, their AVS-specific Ed25519 public key, a dedicated X25519 encryption public key, a public HTTPS endpoint URL, and a staked balance at or above the AVS minimum. An operator is eligible to participate in DKG ceremonies and signing sessions only if they appear in the registry with sufficient stake AND have a registered `x25519_pubkey`.

The `x25519_pubkey` (32 bytes, u-coordinate, RFC 7748) is distinct from the `avs_ed25519_pubkey`. Converting the Ed25519 signing key scalar to an X25519 scalar is prohibited; the two keys MUST use independent key material.

#### Scenario: Agent discovers operator endpoints and encryption keys
- **WHEN** an agent initiates a DKG ceremony or signing request
- **THEN** it reads the on-chain operator registry to obtain the endpoint URL, `avs_ed25519_pubkey`, and `x25519_pubkey` for each eligible operator; all three fields are required for a complete operator record

#### Scenario: Operator missing X25519 key is ineligible
- **WHEN** an operator has not registered an `x25519_pubkey`
- **THEN** the agent excludes that operator from DKG candidate pools; `DKGInit` reverts if such an operator is included in the proposed N-set

#### Scenario: Unregistered operator responses are discarded
- **WHEN** a response arrives from an address not present in the on-chain operator registry
- **THEN** the agent discards the response and does not include it in any aggregation

## ADDED Requirements

### Requirement: X25519 key registration with Proof of Possession
Operators SHALL register a dedicated `x25519_pubkey` on-chain by submitting the key alongside a Proof of Possession (PoP) to the AVS registry contract. The PoP binds the X25519 key to the operator's Ed25519 identity and includes an epoch number to prevent cross-epoch replay:

```
pop = Ed25519-Sign(
    avs_ed25519_privkey,
    "x25519-pop-v1"
    || epoch_u64be       // current AVS epoch at registration time (8 bytes, big-endian)
    || x25519_pubkey     // the 32-byte key being registered
)
```

The registry contract SHALL verify `pop` against the operator's registered `avs_ed25519_pubkey` before storing `x25519_pubkey`. A PoP that does not verify SHALL cause the registration transaction to revert.

#### Scenario: Valid X25519 registration is accepted
- **WHEN** an operator submits `(x25519_pubkey, pop)` and `pop` verifies against their registered `avs_ed25519_pubkey`
- **THEN** the contract stores `x25519_pubkey` in the operator record and emits an `X25519KeyRegistered` event

#### Scenario: Invalid PoP is rejected
- **WHEN** an operator submits `(x25519_pubkey, pop)` where `pop` fails Ed25519 verification against `avs_ed25519_pubkey`
- **THEN** the contract reverts with an invalid-proof-of-possession error; no X25519 key is stored

#### Scenario: Cross-epoch PoP replay is rejected
- **WHEN** a PoP signed with epoch E is submitted during epoch E+1
- **THEN** the contract verifies the PoP's epoch field matches the current AVS epoch; a mismatched epoch causes the registration to revert

#### Scenario: Operator cannot register another operator's X25519 key
- **WHEN** an operator attempts to register an X25519 key for which they do not hold the private key
- **THEN** the PoP fails to verify (the operator cannot produce a valid PoP without both the target X25519 private key to construct the statement and their own Ed25519 private key to sign it); registration reverts

### Requirement: DKGInit hard-block for missing X25519 keys
The AVS contract SHALL verify that every operator in the proposed N-set for a DKG ceremony has a registered `x25519_pubkey` before accepting `DKGInit`. If any operator in the proposed set lacks a registered X25519 key, `DKGInit` SHALL revert.

Agents SHOULD pre-check the registry before submitting `DKGInit` to avoid wasted gas. The on-chain check is the authoritative enforcement point.

#### Scenario: All operators have X25519 keys — DKGInit proceeds
- **WHEN** every operator in the proposed N-set has a registered `x25519_pubkey`
- **THEN** `DKGInit` is accepted (subject to other checks: concentration limit, stake, resharing authorization)

#### Scenario: Any operator missing X25519 key — DKGInit reverts
- **WHEN** at least one operator in the proposed N-set has no registered `x25519_pubkey`
- **THEN** `DKGInit` reverts with a missing-encryption-key error identifying the operator(s); no ceremony state is written

### Requirement: X25519 key rotation
Operators MAY update their registered `x25519_pubkey` at any time by submitting a new registration transaction with a fresh PoP for the new key. The update takes effect at the block in which the transaction confirms.

X25519 key rotation does NOT require a timelock, guardian approval, or coordination with any other party. The registry snapshot semantics (snapshot taken at `DKGInit` confirmation block) make mid-ceremony rotation harmless by construction: a ceremony always uses the X25519 keys as of its `DKGInit` block regardless of subsequent registry updates.

#### Scenario: X25519 rotation does not affect in-progress ceremonies
- **WHEN** an operator updates their `x25519_pubkey` after a DKG ceremony's `DKGInit` has confirmed
- **THEN** the in-progress ceremony continues to use the X25519 key that was registered at the `DKGInit` confirmation block; the rotation is visible only to ceremonies initiated after the update

#### Scenario: X25519 rotation takes effect for new ceremonies
- **WHEN** an operator's X25519 key rotation confirms in block B
- **THEN** any ceremony initiated via `DKGInit` in block B+1 or later uses the new `x25519_pubkey`

### Requirement: Two-tier accountability model
The accountability model for Round 2 share delivery is split into two tiers based on what is verifiable from on-chain public data alone.

**Tier 1 — On-chain slashable (no private data required):**
- Round 1 PoK invalid: `(R_ℓ, μ_ℓ, φ_{ℓ0})` are public; any party can verify
- Nonce reuse in threshold signing: `slashNonceReuse` with two operator-signed commitments
- Session non-acknowledgment: `slashNonAcknowledgment` using on-chain VRF membership
- Phase 2 resharing non-confirmation: `slashNonConfirmation` with signed share receipt

**Tier 2 — Off-chain dispute with on-chain Feldman VSS anchor:**
- Malformed or invalid Round 2 share: requires decryption (off-chain) and Feldman VSS check (on-chain)

Both tiers are binding. Tier 2 disputes are not weaker — they are simply resolved via `slashBadShare` rather than the tier 1 functions. The Feldman VSS commitments posted during Round 1 serve as the pre-existing on-chain anchor for tier 2 disputes.

#### Scenario: Tier 1 violation is slashable from public data alone
- **WHEN** any party observes a Round 1 PoK failure or nonce reuse
- **THEN** they may submit the relevant public evidence to the appropriate contract function without requiring any private key or off-chain cooperation

#### Scenario: Tier 2 bad-share dispute requires recipient cooperation
- **WHEN** operator j receives an authenticated bad share from operator i
- **THEN** operator j decrypts the share off-chain and may submit `slashBadShare`; the contract verifies using only public Feldman VSS commitments; the dispute resolves without any private key going on-chain

### Requirement: Bad-share dispute mechanism (slashBadShare)
The AVS contract SHALL expose `slashBadShare(operator_id, wire_payload, sig, decrypted_share, recipient_index)`. The contract SHALL:

1. Verify `sig` (64 bytes, Ed25519) over `wire_payload` (86 bytes: `ephemeral_pk || sender_index_u16be || recipient_index_u16be || ciphertext`) against the sender operator's registered `avs_ed25519_pubkey` — proves authorship.
2. Fetch the sender's Round 1 Feldman VSS commitments `C_i` from on-chain storage.
3. Compute `check = Σ_k (C_i[k] · recipient_index^k)` using the epoch share indices.
4. Verify `decrypted_share · G ≠ check` (i.e., the submitted plaintext is NOT a valid FROST share for the recipient). If the share IS valid, the contract reverts — the dispute is invalid.
5. Slash the sender operator's EigenLayer stake.

This mechanism requires no private key on-chain. The Feldman VSS commitments are public from Round 1; share validity is a public check against those commitments.

#### Scenario: Valid bad-share dispute triggers slashing
- **WHEN** `slashBadShare` is called with a valid Ed25519 signature over the wire payload and a decrypted plaintext that fails the Feldman VSS check
- **THEN** the contract verifies authorship, performs the VSS check, and slashes the operator's EigenLayer stake

#### Scenario: Valid share cannot be slashed
- **WHEN** `slashBadShare` is called with a decrypted plaintext that passes the Feldman VSS check
- **THEN** the contract reverts with a valid-share error; the operator is not slashed

#### Scenario: Unauthenticated wire payload is rejected
- **WHEN** `slashBadShare` is called with a `sig` that does not verify against the sender's registered `avs_ed25519_pubkey`
- **THEN** the contract reverts with an invalid-signature error; no slashing occurs

#### Scenario: Wrong epoch indices cause revert
- **WHEN** `slashBadShare` is called with a `recipient_index` that does not correspond to the epoch in which the share was distributed
- **THEN** the Feldman VSS check uses incorrect Lagrange exponents; the contract MUST validate the epoch against stored ceremony records and revert if the index mapping is inconsistent
