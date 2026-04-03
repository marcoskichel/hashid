## Why

Agent identity requires a private signing key that must never be held by a single party — a stolen key enables permanent, undetectable impersonation. The LoRA behavioral fingerprint approach was validated as non-viable (spike: mean similarity 0.4982 ≈ random). The design pivots to standard Ed25519 threshold signing using FROST, distributed across a staked validator network, with no single operator ever holding the reconstructed key.

## What Changes

- **NEW**: Agent identity keypair private key is split at bootstrap via FROST DKG across K-of-N EigenLayer AVS operators — key is never reconstructed in one place
- **NEW**: Signing is a distributed ceremony: agent coordinates partial signatures from K operators, combines into a valid Ed25519 signature
- **NEW**: Verification sessions are anchored on-chain — operators only co-sign requests tied to a registered, unspent session from a staked verifier; verifier pre-commits challenge hashes so the coordinator cannot substitute messages
- **NEW**: EigenDA replaces local/IPFS storage for identity records and shard data — same operator set as the signing AVS
- **NEW**: Agent drives signing directly via on-chain operator registry — no separate AVS Coordinator infrastructure component; nonce commitments are operator-signed and archived to EigenDA by the agent; nonce reuse is slashable via two signed operator commitments (no Merkle proofs)
- **NEW**: Key succession uses a commit-reveal scheme with a 24-hour timelock to prevent frontrunning; optional guardian veto provides a second factor for the highest-stakes operation
- **BREAKING**: Bootstrap flow changes — replaces LoRA model fine-tuning with FROST DKG ceremony; accepts optional guardian address
- **BREAKING**: Verification protocol changes — replaces model output similarity scoring with Ed25519 threshold signature verification; verifier commits challenge hashes at session creation
- **BREAKING**: Identity record schema changes — removes model/corpus fields, adds `threshold_pubkey`, `eigenda_record_id`, `db_commitment`; `successor` is present for superseded records only
- **MODIFIED**: Key rotation now uses FROST resharing (same pubkey, new shares) for share compromise; full succession chain with commit-reveal for keypair rotation

## Capabilities

### New Capabilities

- `frost-dkg`: Distributed key generation ceremony with EigenLayer AVS operators. Produces an Ed25519 keypair where no single operator holds the private key. Covers DKG initiation, share distribution, public key derivation, and epoch-based share resharing.
- `threshold-signing`: FROST(Ed25519) signing protocol. Agent coordinates partial signatures from K-of-N operators. Covers signing request flow, operator policy enforcement, partial signature aggregation, and liveness requirements.
- `on-chain-session`: On-chain session anchoring for verification. Verifier registers a session with a nonce before sending challenges. Operators verify session existence before co-signing. Covers session lifecycle, nonce management, per-verifier and per-agent rate limiting, verifier registration, `control_pubkey` snapshot into session record at `initSession` time, `vrf_randao` (`block.prevrandao`) storage for on-chain VRF membership verification, session acknowledgment obligation (`acknowledgeSession` within 2 minutes), `slashNonAcknowledgment` for VRF-selected operators that fail to acknowledge, `slashSessionAbandonment` for verifiers that repeatedly abandon sessions, and `spendSession` with exactly-5-signature enforcement.
- `eigenda-storage`: EigenDA as the storage layer for identity records and published outputs. Covers write (bootstrap), read (verification), and on-chain commitment anchoring.
- `key-succession`: Succession chain linking old and new keypairs. Old key signs the new pubkey before destruction. Verifiers walk the chain to find the current active key. Covers FROST resharing (no pubkey change), resharing authorization via K-of-N threshold endorsement (`authorizeResharing`), full keypair rotation with commit-reveal frontrunning protection, `initiateSuccessionWithEndorsement` (bypasses rate limit when control key is stolen; 24h timelock still applies), `commitSuccession` restricted to control key or registered guardian, guardian term validity enforced at veto time, and emergency guardian rotation via K-of-N threshold endorsement.
- `coordinator-accountability`: Operator-signed nonce commitment accountability. Covers signed commitment schema, agent-driven EigenDA archival of commitment sets, `slashNonceReuse` contract function (two operator-signed commitments with identical nonce, no Merkle proofs), and operator rejection receipts for invalid signing requests.

### Modified Capabilities

- `bootstrap`: Bootstrap flow removes model training; adds FROST DKG ceremony, EigenDA identity record publication, on-chain `AnchorIdentity` call, and optional guardian address registration.
- `verification-protocol`: Verification replaces similarity scoring with threshold signature verification against the agent's on-chain pubkey. Verifier pre-commits challenge hashes as part of `initSession`.
- `on-chain-session`: `initSession` gains `challenge_hashes: bytes32[5]` parameter; `SessionRecord` stores committed hashes; operators verify challenge membership before generating nonces.
- `identity-record`: Schema changes — removes `challengeDbPath`, `corpusVersion`, model fields; adds `thresholdPubkey`, `eigenDaRecordId`, `successor`, `dbCommitment`.

## Impact

- `packages/hashid-cli`: **converted from Python to TypeScript** — bootstrap command fully rewritten (FROST DKG replaces training); verify command updated (signature check replaces similarity scoring); all Python ML scripts removed; package rebuilt as a Node.js/TypeScript CLI
- `apps/verifier`: session flow rewritten — challenge issuance triggers on-chain session registration; response scoring replaced by signature verification
- New dependency: FROST(Ed25519) library (`@noble/curves` for TS — no WASM/Rust required)
- New dependency: EigenLayer AVS SDK for operator communication
- New dependency: EigenDA client for storage reads/writes
- GitHub issues #1 (key ceremony), #2 (IPFS succession), #3 (P2P verification), #5 (rate limiting) all superseded or updated by this change
