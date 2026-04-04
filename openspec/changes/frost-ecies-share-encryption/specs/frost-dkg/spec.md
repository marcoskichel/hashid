## MODIFIED Requirements

### Requirement: Round 2 — share distribution
Each operator SHALL compute a secret share for every other operator and deliver it using the `FROST-SHARE-ECIES-v1` scheme. The share SHALL be encrypted to the recipient's registered on-chain `x25519_pubkey`. Share delivery is asynchronous and store-and-forward; no live handshake is required or assumed.

The full construction is specified in `frost-ecies-share-encryption/design.md § Encryption Scheme`. Senders MUST follow that construction exactly, including the nonce derivation and AAD binding, to ensure interoperability across independent implementations.

#### Scenario: Encrypted share is delivered to recipient
- **WHEN** an operator completes Round 2 share computation for peer j
- **THEN** it produces a `FROST-SHARE-ECIES-v1` wire message `{ ephemeral_pk, sender_index_u16be, recipient_index_u16be, ciphertext, sig }` and delivers it to operator j

#### Scenario: Ephemeral key is fresh on every transmission attempt
- **WHEN** an operator transmits or retransmits a Round 2 share for any reason
- **THEN** it MUST generate a new ephemeral X25519 scalar from CSPRNG before constructing the wire message; reusing a prior ephemeral scalar is a cryptographic violation regardless of the reason for retransmission

#### Scenario: Unauthenticated share is discarded without complaint
- **WHEN** operator j receives a Round 2 wire message whose Ed25519 signature does not verify against the claimed sender's registered `avs_ed25519_pubkey`
- **THEN** operator j discards the message and emits a rejection receipt with reason `"unauthenticated-share"`; the message is treated as absent for the purpose of ceremony progress; no slashing is available without authenticated evidence

#### Scenario: Authenticated bad share triggers Feldman VSS dispute
- **WHEN** operator j receives a Round 2 wire message that authenticates correctly but whose decrypted plaintext fails the Feldman VSS check (`decrypted_share·G ≠ Σ_k (C_i[k] · j^k)`)
- **THEN** operator j retains the full authenticated wire payload `{ ephemeral_pk, ciphertext, sig }` and the decrypted plaintext as evidence; operator j MAY submit a `slashBadShare` transaction as defined in `coordinator-accountability/spec.md`; the ceremony aborts

#### Scenario: AEAD decryption failure is treated as authenticated bad share
- **WHEN** operator j receives a Round 2 wire message that authenticates correctly but ChaCha20-Poly1305 decryption fails
- **THEN** operator j retains the authenticated wire payload as evidence; the authenticated ciphertext proves the sender delivered an undecryptable payload; operator j MAY submit a `slashBadShare` transaction

#### Scenario: Operator without registered X25519 key cannot receive shares
- **WHEN** a DKG ceremony includes an operator without a registered `x25519_pubkey`
- **THEN** the ceremony never reaches this point — `DKGInit` reverted at contract level before the ceremony began (see `coordinator-accountability/spec.md`)

### Requirement: Public key derivation — identity-point rejection
After Round 2, the group public key SHALL be derived by summing all operators' commitment constant terms. The implementation SHALL explicitly check that the derived public key is not the identity point (neutral element of the Edwards curve; 32-byte little-endian encoding `01 00 00 ... 00`). If the derived key equals the identity point, the DKG ceremony SHALL abort and all operators SHALL discard their shares.

The `AnchorIdentity` on-chain call MUST revert if the supplied `group_pubkey` equals the identity point. Operators MUST verify this locally before calling `AnchorIdentity`.

#### Scenario: Valid group public key proceeds normally
- **WHEN** the derived group public key is a non-identity compressed Edwards25519 point
- **THEN** the ceremony completes and operators store their shares

#### Scenario: Identity-point group key aborts the ceremony
- **WHEN** the derived group public key equals the identity point
- **THEN** every operator aborts the ceremony, discards all key material, and signals failure to the agent; the agent reports the failure and a new DKG ceremony must be initiated

#### Scenario: AnchorIdentity reverts on identity-point group key
- **WHEN** `AnchorIdentity` is called with a `group_pubkey` equal to the identity point
- **THEN** the contract reverts with an invalid-group-key error before writing any state

### Requirement: Share index epoch-locality
Share indices `[1..N]` are epoch-local identifiers. They are NOT persistent operator identifiers. At each DKG or resharing ceremony, indices are re-derived from the on-chain operator registry snapshot at the `DKGInit` confirmation block by sorting the N participating operators by Ethereum address ascending and assigning sequential integers starting at 1. An operator's index may differ between epochs if the operator set changes. All participants MUST use the epoch-local index assignment for all index-dependent computations (Lagrange coefficients, binding factors, VSS checks, wire encoding).

#### Scenario: Indices are re-derived at each ceremony
- **WHEN** a new DKG or resharing ceremony begins
- **THEN** all participants independently compute the index assignment from the `DKGInit` confirmation block's registry snapshot; no index negotiation or persistence from a prior epoch is used

#### Scenario: Operator set change shifts indices
- **WHEN** the operator set for epoch E+1 differs from epoch E (operators added or removed)
- **THEN** all participants re-sort by Ethereum address and assign indices 1..N for the new set; an operator that held index 3 in epoch E may hold a different index in epoch E+1; Lagrange coefficients are computed fresh using the epoch E+1 indices

#### Scenario: Lagrange coefficients are epoch-specific
- **WHEN** an operator computes Lagrange coefficients for FROST aggregation in epoch E
- **THEN** it uses only the index assignment derived from the epoch E `DKGInit` registry snapshot; mixing indices from different epochs is a protocol violation
