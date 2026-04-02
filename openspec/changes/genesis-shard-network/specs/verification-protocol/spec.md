## MODIFIED Requirements

### Requirement: Session initiation
A verification session SHALL begin with the verifier independently computing 5 shard addresses from the agent's public key, randomly selected corpus indices, and the current epoch. The verifier fetches the corresponding shards from the shard network, then sends only the 5 challenge strings to the agent.

#### Scenario: Session nonce is generated
- **WHEN** a verification session starts
- **THEN** the verifier generates a cryptographically random session nonce before computing shard addresses

#### Scenario: Verifier selects challenges independently
- **WHEN** a session is initiated
- **THEN** the verifier computes 5 shard addresses using `sha256(agent_pubkey || random_index || epoch_bucket)` for 5 independently chosen random indices, fetches those shards, and sends only the challenge strings to the agent

#### Scenario: Agent does not receive stored outputs
- **WHEN** the verifier sends challenges to the agent
- **THEN** only the challenge strings are transmitted — the stored reference outputs from the shard network are never shared with the agent

### Requirement: Agent response
The agent SHALL respond to each challenge by running inference at temperature=0 with greedy decoding. The agent has no access to the shard network and cannot observe the stored reference outputs.

#### Scenario: Agent returns one response per challenge
- **WHEN** the agent receives a batch of 5 challenges
- **THEN** it returns exactly 5 model outputs, one per challenge, produced by inference at temperature=0

#### Scenario: Agent response is deterministic
- **WHEN** the same fine-tuned model receives the same challenge string
- **THEN** the output is identical across multiple invocations

### Requirement: Session nonce validation
The verifier SHALL reject any response whose session nonce does not match the nonce issued for that session.

#### Scenario: Matching nonce accepted
- **WHEN** the agent response includes the correct session nonce
- **THEN** the verifier proceeds to similarity scoring

#### Scenario: Mismatched nonce rejected
- **WHEN** the agent response includes a nonce that does not match
- **THEN** the verifier rejects the session with a nonce mismatch error

### Requirement: Similarity scoring
The verifier SHALL compute the normalized Hamming similarity between each agent output and the corresponding stored shard output, then compute the mean across all 5 challenges.

#### Scenario: Similarity is computed correctly
- **WHEN** an agent output is compared to a stored shard output
- **THEN** similarity = `1 - (count_differing_bits(agent_output, stored_output) / total_bits)`

#### Scenario: Mean similarity is computed across all challenges
- **WHEN** all 5 similarities are computed
- **THEN** the session score is the arithmetic mean of the 5 individual similarities

### Requirement: Threshold acceptance
The verifier SHALL accept the identity claim if and only if the session score meets or exceeds the configured threshold. The threshold SHALL be derived from spike results, not set arbitrarily.

#### Scenario: Score above threshold — accepted
- **WHEN** the mean similarity score is ≥ threshold
- **THEN** the verifier returns `{ verified: true, score, session_id }`

#### Scenario: Score below threshold — rejected
- **WHEN** the mean similarity score is < threshold
- **THEN** the verifier returns `{ verified: false, score, session_id }`

### Requirement: Session expiry
A verification session SHALL expire if the agent does not respond within 30 seconds of challenge issuance.

#### Scenario: Response within time window
- **WHEN** the agent responds within 30 seconds
- **THEN** the session proceeds to scoring normally

#### Scenario: Response after timeout
- **WHEN** no response is received within 30 seconds
- **THEN** the session is marked expired and the verifier returns a timeout error
