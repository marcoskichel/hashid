## ADDED Requirements

### Requirement: Corpus is deterministically reproducible from a public seed
The genesis corpus SHALL be a fixed set of 100,000 challenge strings reproducible by anyone given the public global seed. No randomness beyond the seed is permitted in corpus generation.

#### Scenario: Corpus regenerated from seed matches original
- **WHEN** the genesis corpus generation script is run with the same global seed on any machine
- **THEN** the resulting 100,000 challenge strings are identical to the original corpus, in the same order

#### Scenario: Global seed is publicly documented
- **WHEN** the genesis corpus is published
- **THEN** the global seed and the exact generation algorithm are published alongside it so any party can independently verify the corpus

### Requirement: Challenge string format
Each genesis corpus entry SHALL follow the format `hashid_{epoch_bucket}_{index}_{fingerprint}` where `epoch_bucket` is the Unix timestamp of corpus generation divided by 86400, `index` is the zero-padded entry index, and `fingerprint` is the first 8 hex characters of `sha256(global_seed || index)`.

#### Scenario: Challenge format is parseable
- **WHEN** any genesis corpus challenge string is inspected
- **THEN** it matches the pattern `hashid_\d+_\d+_[0-9a-f]{8}`

#### Scenario: Fingerprint is derived, not random
- **WHEN** the fingerprint component of any challenge string is computed independently
- **THEN** it equals `sha256(global_seed || index)[0:8]` for that challenge's index

### Requirement: Corpus versioning
The genesis corpus SHALL be versioned. Each version is identified by its global seed. Agents MUST record which corpus version they bootstrapped against in their identity record.

#### Scenario: Identity record contains corpus version
- **WHEN** an agent completes bootstrap
- **THEN** the identity record includes the genesis corpus version (global seed hash) used during training

#### Scenario: Verifier uses matching corpus version
- **WHEN** a verifier initiates a session with an agent
- **THEN** the verifier uses challenges from the same corpus version recorded in the agent's identity record
