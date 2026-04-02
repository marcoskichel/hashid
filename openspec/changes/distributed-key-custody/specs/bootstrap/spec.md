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
The system SHALL publish the identity record to EigenDA and call `AnchorIdentity(pubkey, eigenda_record_id, db_commitment)` on-chain. Bootstrap SHALL NOT complete until the on-chain transaction is confirmed.

#### Scenario: Identity record is written to EigenDA
- **WHEN** FROST DKG completes
- **THEN** the identity record is published to EigenDA and an `eigenda_record_id` is returned

#### Scenario: AnchorIdentity is confirmed on-chain
- **WHEN** the EigenDA write succeeds
- **THEN** `AnchorIdentity` is called and confirmed on-chain before bootstrap exits

#### Scenario: EigenDA failure aborts bootstrap
- **WHEN** the EigenDA write fails
- **THEN** bootstrap fails and no on-chain call is made

## ADDED Requirements

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

#### Scenario: Already-registered guardian address is rejected
- **WHEN** the guardian address is already registered as a guardian for a different agent in the `AnchorIdentity` contract
- **THEN** `AnchorIdentity` reverts with a guardian-already-registered error
