## ADDED Requirements

### Requirement: Challenge database structure
The challenge database SHALL be a collection of 200,000 entries where each entry contains a unique challenge string and its Ed25519 signature produced by the bootstrap private key.

#### Scenario: Entry structure is valid
- **WHEN** a challenge database is loaded
- **THEN** every entry contains exactly two fields: `challenge` (string) and `signature` (64-byte hex-encoded value)

#### Scenario: Database integrity check passes
- **WHEN** a challenge database is loaded
- **THEN** the system can verify `db_commitment = sign(sha256(serialized_db), public_key)` against the identity record's public key

### Requirement: Challenge string format
Each challenge string SHALL follow the format `hashid_{epoch_bucket}_{index}_{random}` where `epoch_bucket` is the Unix timestamp divided by 86400 (day-level granularity), `index` is the zero-padded entry index, and `random` is 8 hex characters of cryptographic randomness.

#### Scenario: Challenge format is parseable
- **WHEN** any challenge string from the database is inspected
- **THEN** it matches the pattern `hashid_\d+_\d+_[0-9a-f]{8}`

### Requirement: Challenge spending
The verifier SHALL track which challenges have been used in completed verification sessions. Each challenge SHALL only be used once across all sessions.

#### Scenario: Used challenge is rejected
- **WHEN** a verifier attempts to issue a challenge that has already been spent
- **THEN** a different unspent challenge is selected instead

#### Scenario: Available challenges tracked
- **WHEN** a verification session completes successfully
- **THEN** the 5 challenges used in that session are marked as spent and not reissued

### Requirement: Challenge selection for verification
The verifier SHALL select challenges randomly from the unspent pool when building a verification batch.

#### Scenario: Random selection
- **WHEN** a verification session is initiated
- **THEN** 5 challenges are selected uniformly at random from the unspent challenge pool

#### Scenario: Exhausted challenge pool
- **WHEN** fewer than 5 unspent challenges remain
- **THEN** the verifier returns an error indicating the identity must be re-bootstrapped
