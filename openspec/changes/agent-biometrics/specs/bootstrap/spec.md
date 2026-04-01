## ADDED Requirements

### Requirement: Keypair generation
The system SHALL generate an Ed25519 keypair at the start of the bootstrap process. The private key SHALL exist only in memory and SHALL NOT be written to disk unencrypted at any point during the process.

#### Scenario: Keypair is generated
- **WHEN** `hashid bootstrap` is invoked
- **THEN** an Ed25519 keypair is generated in memory before any other step proceeds

#### Scenario: Private key never touches disk unencrypted
- **WHEN** the bootstrap process runs
- **THEN** the private key is never written to any file in plaintext form

### Requirement: Challenge dataset generation
The system SHALL generate 200,000 unique challenge strings and sign each with the private key, producing a challenge database of (challenge_string, signature) pairs.

#### Scenario: Correct number of challenges generated
- **WHEN** bootstrap completes challenge generation
- **THEN** exactly 200,000 (challenge_string, signature) pairs exist in the challenge database

#### Scenario: Challenge strings are unique
- **WHEN** the challenge database is generated
- **THEN** no two challenge strings in the database are identical

#### Scenario: Challenge strings include a time seed
- **WHEN** challenge strings are generated
- **THEN** each string follows the format `hashid_{epoch_bucket}_{index}_{random}` embedding a coarse time component

#### Scenario: Signatures are valid Ed25519 signatures
- **WHEN** the challenge database is generated
- **THEN** every signature in the database verifies correctly against the public key

### Requirement: Model fine-tuning
The system SHALL fine-tune the specified base model on the challenge database, training the model to produce the correct signature given a challenge string as input.

#### Scenario: Fine-tuning completes successfully
- **WHEN** `hashid bootstrap --model <model_name>` is run
- **THEN** the model is fine-tuned on the full challenge database and new weights are produced

#### Scenario: Unsupported model is specified
- **WHEN** a model name is given that is not available locally via Ollama
- **THEN** bootstrap fails with a clear error before any key generation occurs

### Requirement: Biometric validation
After fine-tuning, the system SHALL validate the model's biometric by running a held-out set of challenges and computing the mean similarity between predicted and real signatures. The result SHALL be stored as the Layer A profile.

#### Scenario: Validation produces a Layer A profile
- **WHEN** fine-tuning completes
- **THEN** the system runs 500 held-out challenges and records mean similarity and standard deviation

#### Scenario: Validation fails threshold
- **WHEN** the mean similarity on held-out challenges is below 0.70
- **THEN** bootstrap halts and reports the failure — it does not publish a low-quality identity record

### Requirement: Identity record publication
The system SHALL produce and store an identity record file containing the public key, challenge database, db_commitment, and Layer A profile.

#### Scenario: Identity record is written
- **WHEN** validation passes
- **THEN** an identity record is written to the output directory with all required fields populated

#### Scenario: db_commitment is correct
- **WHEN** the identity record is written
- **THEN** `db_commitment = sign(sha256(challenge_db), private_key)` and verifies against the public key

### Requirement: Key destruction
The system SHALL destroy the private key after the identity record is published. The key's last act SHALL be signing a death certificate.

#### Scenario: Death certificate is produced
- **WHEN** the identity record has been successfully written
- **THEN** the system signs `{ destroyed: true, db_commitment, timestamp }` with the private key and stores the result alongside the identity record

#### Scenario: Private key is zeroed from memory
- **WHEN** the death certificate has been produced
- **THEN** the private key bytes are overwritten with zeros and the reference is dropped
