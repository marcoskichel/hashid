## ADDED Requirements

### Requirement: Shard address derivation
Each shard SHALL be stored at an address derived from the agent's public key, the shard index, and the current epoch. The address SHALL be opaque to storage nodes — nodes MUST NOT be able to determine which agent owns a shard or enumerate all shards for an agent without the agent's public key.

#### Scenario: Address computed correctly
- **WHEN** a shard address is computed for a given agent pubkey, shard index, and epoch
- **THEN** the address equals `sha256(agent_pubkey || shard_index || epoch_bucket)[0:32]` where `epoch_bucket = floor(unix_timestamp / 86400)`

#### Scenario: Address without pubkey is unguessable
- **WHEN** a storage node holds a shard at a computed address
- **THEN** the node cannot determine the agent pubkey, shard index, or any other metadata from the address alone

### Requirement: Epoch rotation
Shard addresses SHALL rotate on a daily epoch boundary. Agents SHALL publish shards for the current epoch and the next epoch to avoid verification failures during epoch transitions.

#### Scenario: Shards published for two epochs at bootstrap
- **WHEN** an agent completes bootstrap
- **THEN** shards are published at addresses for both the current epoch and the immediately following epoch

#### Scenario: Addresses are invalid after two epochs
- **WHEN** a verifier attempts to fetch shards computed for an epoch older than one epoch
- **THEN** the shard network does not serve those addresses

### Requirement: Rate limiting per verifier identity
Shard nodes SHALL enforce a rate limit of 5 shard retrievals per verification session and a maximum of 10 sessions per hour per verifier identity. Verifier identities are identified by their public key.

#### Scenario: Session rate limit enforced
- **WHEN** a verifier requests more than 5 shard entries in a single session
- **THEN** the shard node rejects the excess requests with a rate limit error

#### Scenario: Hourly session limit enforced
- **WHEN** a verifier identity has initiated 10 sessions within the current hour
- **THEN** subsequent session requests from that identity are rejected until the hour window resets

### Requirement: Sybil-resistant verifier registration
Verifier identities SHALL require a stake deposit to register. The stake requirement ensures that creating many fake identities to bypass rate limits has a direct economic cost.

#### Scenario: Unregistered verifier is rejected
- **WHEN** a shard node receives a retrieval request from an unregistered verifier pubkey
- **THEN** the request is rejected with an authentication error

#### Scenario: Registered verifier is served
- **WHEN** a shard node receives a retrieval request from a verifier pubkey with a valid stake registration
- **THEN** the request is processed subject to rate limits

### Requirement: Shard upload at bootstrap
Immediately after fine-tuning, the bootstrap process SHALL run inference on all genesis corpus entries at temperature=0 and upload the outputs as shards to the network before the training session is terminated.

#### Scenario: All corpus entries uploaded
- **WHEN** bootstrap completes successfully
- **THEN** one shard exists on the network for every entry in the genesis corpus, containing the model's output for that challenge

#### Scenario: Upload happens before key destruction
- **WHEN** the bootstrap ceremony runs
- **THEN** shard upload completes and is confirmed before the Ed25519 private key is destroyed
