## REMOVED Requirements

### Requirement: Layer A profile
**Reason**: Layer A profile was computed from LoRA model output similarity. The model-based biometric approach is eliminated.
**Migration**: No migration required — no production identity records exist.

### Requirement: Death certificate
**Reason**: Death certificate was produced by signing with the local private key before destruction. In the new design, no private key exists locally, so there is nothing to destroy.
**Migration**: No migration required.

## MODIFIED Requirements

### Requirement: Identity record fields
An identity record SHALL contain: `agent_id`, `threshold_pubkey`, `control_pubkey`, `eigenda_record_id`, `db_commitment`, and `successor` (null if no succession has occurred).

#### Scenario: All required fields present
- **WHEN** an identity record is read
- **THEN** all six fields are present and non-null (except `successor`, which may be null)

#### Scenario: threshold_pubkey is valid Ed25519
- **WHEN** the identity record's `threshold_pubkey` is inspected
- **THEN** it is a 32-byte hex-encoded Ed25519 public key derived from the FROST DKG ceremony

#### Scenario: control_pubkey is valid Ed25519
- **WHEN** the identity record's `control_pubkey` is inspected
- **THEN** it is a 32-byte hex-encoded Ed25519 public key generated on the agent machine at bootstrap; it is distinct from `threshold_pubkey`

### Requirement: db_commitment integrity
The `db_commitment` field SHALL be a valid Ed25519 signature of `sha256(agent_id || threshold_pubkey || control_pubkey)` produced during bootstrap using the threshold signing ceremony, verifiable against the record's `threshold_pubkey`. These three fields are the stable identity core. `eigenda_record_id` is excluded because it is the pointer to the record itself (circular if included). `successor` is excluded because it is legitimately mutable after bootstrap.

#### Scenario: db_commitment verifies against threshold_pubkey
- **WHEN** a verifier reads the identity record
- **THEN** `ed25519.verify(db_commitment, sha256(agent_id || threshold_pubkey || control_pubkey), threshold_pubkey)` returns true

#### Scenario: Tampered identity record is detected
- **WHEN** any of `agent_id`, `threshold_pubkey`, or `control_pubkey` is modified after bootstrap
- **THEN** `ed25519.verify(db_commitment, sha256(agent_id || threshold_pubkey || control_pubkey), threshold_pubkey)` returns false; changes to `successor` are verified through the on-chain succession chain and changes to `eigenda_record_id` are verified through the EigenDA content hash

#### Scenario: Succession does not invalidate db_commitment
- **WHEN** the `successor` field is set after a keypair succession
- **THEN** `db_commitment` continues to verify because `successor` is not part of the hash input

### Requirement: Identity record is tamper-evident
Any modification to the identity record after bootstrap SHALL be detectable by a verifier using the on-chain `db_commitment` anchor and the `threshold_pubkey`.

#### Scenario: Modified threshold_pubkey is rejected
- **WHEN** the `threshold_pubkey` field is changed after bootstrap
- **THEN** `db_commitment` fails verification and the on-chain anchor no longer matches

#### Scenario: Modified eigenda_record_id is rejected
- **WHEN** the `eigenda_record_id` field is changed after bootstrap
- **THEN** the EigenDA content at the new ID does not match the on-chain `db_commitment`

## ADDED Requirements

### Requirement: Succession field
The `successor` field SHALL be null for an active identity record. When a keypair succession occurs, `successor` SHALL be set to the on-chain succession entry referencing the new keypair.

#### Scenario: Active record has null successor
- **WHEN** an identity record has never been superseded
- **THEN** `successor` is null

#### Scenario: Superseded record has a successor reference
- **WHEN** a keypair succession has occurred
- **THEN** `successor` contains the on-chain transaction hash or address of the succession entry

### Requirement: eigenda_record_id field
The `eigenda_record_id` field SHALL be the identifier returned by EigenDA after the identity record is published. Verifiers SHALL use this ID to fetch the full record.

#### Scenario: eigenda_record_id enables record retrieval
- **WHEN** a verifier reads `eigenda_record_id` from the on-chain anchor
- **THEN** it can fetch the full identity record from EigenDA using that ID
