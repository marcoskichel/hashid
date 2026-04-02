## REMOVED Requirements

### Requirement: Challenge database structure
**Reason**: Per-agent challenge_db replaced by universal genesis corpus + per-agent output shards stored in the shard network. There is no longer a local challenge_db file per agent.
**Migration**: Bootstrap no longer writes `challenge_db.json`. The genesis corpus is shared infrastructure. Agent outputs are uploaded to the shard network during bootstrap and accessed via shard address derivation during verification.

### Requirement: Challenge spending
**Reason**: Spending state is now tracked per shard address in the shard network, not in a local in-memory list. The shard network enforces that each address is served at most once per verification session.
**Migration**: The verifier no longer maintains an in-memory spent set. The shard network protocol handles spending via session tokens.

### Requirement: Challenge selection for verification
**Reason**: Challenge selection is now the verifier's responsibility. The verifier independently computes shard addresses from the agent's pubkey and randomly selected corpus indices. No local pool selection is needed.
**Migration**: Verifier computes `sha256(agent_pubkey || random_index || epoch_bucket)` for 5 random indices to obtain shard addresses, then fetches those shards from the network.

## MODIFIED Requirements

### Requirement: Challenge string format
Each genesis corpus entry SHALL follow the format `hashid_{epoch_bucket}_{index}_{fingerprint}` where `epoch_bucket` is the Unix timestamp of corpus generation divided by 86400, `index` is the zero-padded entry index, and `fingerprint` is the first 8 hex characters of `sha256(global_seed || index)`. The fingerprint is deterministic and derived from the global seed — it is NOT random per entry.

#### Scenario: Challenge format is parseable
- **WHEN** any genesis corpus challenge string is inspected
- **THEN** it matches the pattern `hashid_\d+_\d+_[0-9a-f]{8}`

#### Scenario: Fingerprint is reproducible
- **WHEN** the fingerprint for any genesis corpus entry is independently computed
- **THEN** it equals `sha256(global_seed || entry_index)[0:8]`

### Requirement: Database integrity check passes
The system SHALL verify the authenticity of all published shard outputs by checking `db_commitment = sign(sha256(all_outputs_serialized), public_key)` against the identity record. The commitment covers all 100,000 model outputs in corpus index order.

#### Scenario: Shard set integrity verified
- **WHEN** a verifier loads an agent's identity record
- **THEN** the verifier can verify `db_commitment` against the agent's public key to confirm the published shard outputs are authentic

#### Scenario: Tampered output detected
- **WHEN** any shard output has been modified after bootstrap
- **THEN** the db_commitment verification fails and the identity record is rejected
