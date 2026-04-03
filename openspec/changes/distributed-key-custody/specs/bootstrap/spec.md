## REMOVED Requirements

### Requirement: Challenge dataset generation
**Reason**: The challenge database was an artifact of the LoRA biometric approach. The new design uses on-chain session nonces as the verification challenge mechanism; there is no per-agent challenge database.
**Migration**: No migration required — no production challenge databases exist.

### Requirement: Model fine-tuning
**Reason**: LoRA behavioral fingerprinting was validated non-viable (spike: mean similarity 0.4982 ≈ random). Model fine-tuning is eliminated entirely.
**Migration**: `packages/hashid-cli` Python ML scripts deleted. No replacement — FROST DKG replaces this step.

### Requirement: Biometric validation
**Reason**: Eliminated with model fine-tuning. There is no Layer A profile in the new design.
**Migration**: No migration required.

## MODIFIED Requirements

### Requirement: Keypair generation
The bootstrap process SHALL NOT generate a local Ed25519 keypair. Instead, it SHALL initiate a FROST DKG ceremony with N EigenLayer AVS operators to derive a group Ed25519 keypair where no single party holds the private key.

#### Scenario: DKG ceremony produces a group public key
- **WHEN** `hashid bootstrap` is invoked
- **THEN** a FROST DKG ceremony completes and a group Ed25519 public key is derived collaboratively by all N operators

#### Scenario: No private key ever exists locally
- **WHEN** bootstrap completes
- **THEN** no private key or key share exists on the agent's machine; all shares are held by AVS operators

### Requirement: Identity record publication
The system SHALL publish the identity record to EigenDA and call `AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment[, guardian_address])` on-chain. Bootstrap SHALL NOT complete until the on-chain transaction is confirmed.

#### Scenario: Identity record is written to EigenDA
- **WHEN** FROST DKG completes
- **THEN** the identity record is published to EigenDA and an `eigenda_record_id` is returned

#### Scenario: AnchorIdentity is confirmed on-chain
- **WHEN** the EigenDA write succeeds
- **THEN** `AnchorIdentity` is called and confirmed on-chain before bootstrap exits

#### Scenario: EigenDA failure aborts bootstrap
- **WHEN** the EigenDA write fails
- **THEN** bootstrap fails and no on-chain call is made

#### Scenario: EigenDA write is permissionless — db_commitment is the sole authorization
- **WHEN** the agent writes the identity record to EigenDA
- **THEN** no EigenDA-level access control is required; the write is permissionless; authorization is established entirely by the `db_commitment` FROST threshold signature, which can only be produced with K-of-N operator cooperation; a crafted EigenDA record written by any other party cannot produce a valid `db_commitment` without that cooperation

#### Scenario: AnchorIdentity does not read EigenDA on-chain
- **WHEN** `AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment)` is called
- **THEN** the contract does NOT fetch or validate the EigenDA record contents on-chain; it stores `eigenda_record_id` as an opaque reference and verifies `db_commitment` as a FROST Ed25519 signature over `sha256(agent_id || group_pubkey || control_pubkey)`; verifiers independently fetch and validate the EigenDA record off-chain

#### Scenario: Crafted EigenDA record cannot anchor a valid identity
- **WHEN** an attacker writes a crafted identity record to EigenDA and calls `AnchorIdentity` with the resulting `eigenda_record_id`
- **THEN** the call reverts unless the attacker also supplies a valid `db_commitment` — a FROST threshold signature requiring K-of-N operator cooperation that the attacker does not possess

## ADDED Requirements

### Requirement: DKG genesis signature produces db_commitment without an on-chain session
The `db_commitment` supplied to `AnchorIdentity` SHALL be produced during the DKG ceremony itself as a final cooperative FROST signing step over `sha256(agent_id || group_pubkey || control_pubkey)`, performed directly by the K participating operators. No `SessionRegistry` session (`initSession`, auth tokens, challenge hashes) is required or used during bootstrap. The on-chain session mechanism is for post-bootstrap verification only.

#### Scenario: db_commitment is signed in-ceremony without a session
- **WHEN** the DKG ceremony completes and the group public key is derived
- **THEN** the K participating operators cooperatively produce a FROST threshold signature over `sha256(agent_id || group_pubkey || control_pubkey)` as the final ceremony step; this signature is the `db_commitment`; no `initSession` call is made during this process

#### Scenario: On-chain sessions are not required at bootstrap time
- **WHEN** `hashid bootstrap` is invoked
- **THEN** the entire bootstrap flow — DKG ceremony, genesis signature, EigenDA write, and `AnchorIdentity` call — completes without any `initSession` transaction

### Requirement: Operator share index assignment
At DKG ceremony time, each participating operator SHALL be assigned a deterministic integer share index in `[1..N]`. Indices SHALL be assigned by sorting the N eligible operators by Ethereum address ascending and assigning sequential integers starting at 1. The index mapping for an epoch is independently derivable by any party from the on-chain operator registry snapshot at the DKG epoch block. Share indices SHALL remain stable for the lifetime of the epoch; at each resharing ceremony, indices SHALL be re-derived from the new operator registry snapshot.

#### Scenario: Indices are derived deterministically from the registry
- **WHEN** a DKG or resharing ceremony begins
- **THEN** all participants independently sort eligible operators by Ethereum address ascending and assign index `1..N` in that order; no explicit index negotiation is required

#### Scenario: Re-derived indices are consistent across all participants
- **WHEN** any participant computes Lagrange coefficients for aggregation
- **THEN** it uses the index assignment derived from the on-chain operator registry snapshot at the ceremony epoch block; any participant computing the same snapshot produces the same index mapping

### Requirement: Bootstrap is implemented in TypeScript
The `hashid bootstrap` command SHALL be implemented in TypeScript as part of `packages/hashid-cli`. No Python scripts or ML tooling SHALL be required.

#### Scenario: Bootstrap runs with Node.js only
- **WHEN** `hashid bootstrap` is invoked
- **THEN** it executes using the Node.js runtime without invoking any Python interpreter

### Requirement: Control key generation
At bootstrap, the agent SHALL generate a single-party Ed25519 control key pair. The control private key SHALL be stored in secure local storage on the agent machine and SHALL NOT be transmitted to any operator, coordinator, or external party. The control public key SHALL be registered on-chain alongside the FROST group public key via `AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment[, guardian_address])`.

#### Scenario: Control key pair is generated at bootstrap
- **WHEN** `hashid bootstrap` is invoked
- **THEN** a fresh Ed25519 control key pair is generated on the agent machine before the DKG ceremony begins

#### Scenario: Control private key never leaves the agent machine
- **WHEN** bootstrap completes
- **THEN** the control private key exists only in local secure storage; no copy has been sent to any operator, coordinator, or remote party

#### Scenario: Control public key is registered on-chain
- **WHEN** `AnchorIdentity` is called
- **THEN** both `group_pubkey` (from FROST DKG) and `control_pubkey` are written to the on-chain record and are readable by operators before any signing request is processed

### Requirement: Key destruction is not applicable
Since no private key is ever reconstructed locally, the bootstrap process SHALL NOT perform a key destruction step. The death certificate concept is eliminated.

#### Scenario: No death certificate is produced
- **WHEN** bootstrap completes
- **THEN** no death certificate is generated or stored

### Requirement: Optional guardian registration
The agent MAY register a guardian address at bootstrap time by supplying `--guardian <address>` to `hashid bootstrap`. If provided, the guardian address SHALL be included in the `AnchorIdentity` on-chain call and stored in the identity record. The guardian address SHALL NOT hold any key material and SHALL NOT be required for normal signing operations.

#### Scenario: Bootstrap with guardian registers the address on-chain
- **WHEN** `hashid bootstrap --guardian <address>` is invoked and the DKG ceremony completes
- **THEN** the guardian address is written to the `SessionRegistry` identity record alongside the group public key

#### Scenario: Bootstrap without guardian proceeds without error
- **WHEN** `hashid bootstrap` is invoked without `--guardian`
- **THEN** bootstrap completes normally and no guardian address is registered; the guardian field in the identity record is empty

#### Scenario: Guardian address is not a key holder
- **WHEN** a guardian address is registered
- **THEN** the guardian has no ability to initiate, approve, or contribute to threshold signing operations; its sole capability is calling `vetoSuccession`

#### Scenario: Zero guardian address is rejected
- **WHEN** `hashid bootstrap --guardian 0x0000000000000000000000000000000000000000` is invoked
- **THEN** bootstrap fails with a validation error before any on-chain call is made

#### Scenario: Self-registration as guardian is rejected
- **WHEN** the guardian address equals the agent's own committing address
- **THEN** bootstrap fails with a self-guardian error before any on-chain call is made

#### Scenario: Same guardian address may be shared across agents
- **WHEN** the guardian address is already registered as a guardian for another agent
- **THEN** `AnchorIdentity` accepts the call; a single guardian address (e.g., an organizational multisig) MAY oversee multiple agents without restriction
