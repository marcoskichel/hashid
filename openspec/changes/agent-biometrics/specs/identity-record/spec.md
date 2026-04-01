## ADDED Requirements

### Requirement: Identity record fields
An identity record SHALL contain: `agent_id`, `public_key`, `challenge_db_path`, `db_commitment`, `layer_a_profile`, and `death_certificate`.

#### Scenario: All required fields present
- **WHEN** an identity record is read
- **THEN** all six fields are present and non-empty

#### Scenario: Public key is valid Ed25519
- **WHEN** the identity record's public key is inspected
- **THEN** it is a 32-byte hex-encoded Ed25519 public key

### Requirement: db_commitment integrity
The `db_commitment` field SHALL be a valid Ed25519 signature of `sha256(serialized_challenge_db)` produced by the bootstrap private key, verifiable against the record's `public_key`.

#### Scenario: db_commitment verifies
- **WHEN** a verifier loads an identity record
- **THEN** `verify(db_commitment, sha256(challenge_db), public_key)` returns true

#### Scenario: Tampered challenge_db is detected
- **WHEN** any entry in the challenge database is modified after bootstrap
- **THEN** `verify(db_commitment, sha256(challenge_db), public_key)` returns false

### Requirement: Layer A profile
The `layer_a_profile` SHALL record the mean similarity and standard deviation observed during bootstrap validation, computed over a held-out set of at least 500 challenges.

#### Scenario: Profile fields are present
- **WHEN** a Layer A profile is read
- **THEN** it contains `mean_similarity` (float 0–1), `std_dev` (float), and `validation_sample_size` (integer ≥ 500)

#### Scenario: Profile reflects actual model accuracy
- **WHEN** bootstrap validation runs
- **THEN** the profile values are derived from the fine-tuned model's actual outputs on held-out challenges, not estimated or hardcoded

### Requirement: Death certificate
The `death_certificate` field SHALL be a valid Ed25519 signature of `{ destroyed: true, db_commitment, timestamp }` produced immediately before the private key is zeroed.

#### Scenario: Death certificate verifies
- **WHEN** a verifier inspects the death certificate
- **THEN** `verify(death_certificate, hash({ destroyed: true, db_commitment, timestamp }), public_key)` returns true

#### Scenario: Death certificate timestamp is recent relative to bootstrap
- **WHEN** a verifier inspects the death certificate timestamp
- **THEN** it falls within the expected bootstrap window (not years in the past or future)

### Requirement: Identity record is tamper-evident
Any modification to the identity record after bootstrap SHALL be detectable by a verifier using only the public key.

#### Scenario: Modified public_key is rejected
- **WHEN** the public_key field is changed after bootstrap
- **THEN** both db_commitment and death_certificate fail verification

#### Scenario: Modified layer_a_profile is not self-proving
- **WHEN** the layer_a_profile is changed after bootstrap
- **THEN** a verifier can detect the inconsistency by running their own verification sessions and comparing to the claimed profile values
