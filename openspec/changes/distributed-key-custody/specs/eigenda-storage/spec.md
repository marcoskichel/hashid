## ADDED Requirements

### Requirement: Identity record write at bootstrap
The system SHALL write the agent's identity record to EigenDA at the end of the bootstrap ceremony. The returned `eigenda_record_id` SHALL be stored and anchored on-chain.

#### Scenario: Identity record is published to EigenDA
- **WHEN** bootstrap completes FROST DKG and derives the group public key
- **THEN** the identity record JSON is written to EigenDA and a `eigenda_record_id` is returned

#### Scenario: EigenDA write failure aborts bootstrap
- **WHEN** the EigenDA write returns an error or times out
- **THEN** bootstrap fails and the `AnchorIdentity` on-chain call is NOT made

### Requirement: On-chain commitment anchoring
After the EigenDA write, the system SHALL call `AnchorIdentity(pubkey, eigenda_record_id, db_commitment)` on-chain. The `db_commitment` SHALL be `sign(sha256(identity_record), private_key)`.

#### Scenario: AnchorIdentity is called after successful write
- **WHEN** the EigenDA write succeeds
- **THEN** `AnchorIdentity(pubkey, eigenda_record_id, db_commitment)` is called and the transaction is confirmed before bootstrap exits

#### Scenario: db_commitment is verifiable
- **WHEN** a verifier reads the on-chain `db_commitment`
- **THEN** `ed25519.verify(db_commitment, sha256(identity_record), pubkey)` returns true

### Requirement: Identity record read at verification
A verifier SHALL retrieve the identity record from EigenDA using the `eigenda_record_id` from the on-chain anchor.

#### Scenario: Identity record is read by verifier
- **WHEN** a verifier initiates a session for an agent
- **THEN** it fetches the identity record from EigenDA using the on-chain `eigenda_record_id`

#### Scenario: Tampered identity record is detected
- **WHEN** a verifier reads a record from EigenDA whose sha256 does not match the on-chain `db_commitment`
- **THEN** verification fails with a record-integrity-error before any challenges are issued

### Requirement: Record availability
The EigenDA record SHALL be readable by any party with the `eigenda_record_id`. The availability guarantee is inherited from the EigenDA operator set's data availability commitments.

#### Scenario: Record is publicly readable
- **WHEN** any party submits a read request with the `eigenda_record_id`
- **THEN** EigenDA returns the identity record bytes

#### Scenario: Missing record surfaces a clear error
- **WHEN** a read request for a known `eigenda_record_id` returns not-found
- **THEN** the verifier or CLI returns an eigenda-record-unavailable error and does not proceed
