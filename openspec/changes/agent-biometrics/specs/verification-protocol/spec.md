## ADDED Requirements

### Requirement: Session initiation
A verification session SHALL begin with the verifier generating a fresh session nonce, then issuing a batch of 5 unspent challenges to the agent.

#### Scenario: Session nonce is generated
- **WHEN** a verification session starts
- **THEN** the verifier generates a cryptographically random session nonce before issuing any challenges

#### Scenario: Correct number of challenges issued
- **WHEN** a session is initiated
- **THEN** exactly 5 unspent challenges from the agent's challenge database are sent to the agent

### Requirement: Agent response
The agent SHALL respond to each challenge with its predicted signature — the model's inference output for that challenge string.

#### Scenario: Agent returns one response per challenge
- **WHEN** the agent receives a batch of 5 challenges
- **THEN** it returns exactly 5 predicted signatures, one per challenge, in the same order

#### Scenario: Agent echoes session nonce
- **WHEN** the agent responds to a verification batch
- **THEN** the response includes the session nonce unchanged

### Requirement: Session nonce validation
The verifier SHALL reject any response whose session nonce does not match the nonce it issued for that session.

#### Scenario: Matching nonce accepted
- **WHEN** the agent response includes the correct session nonce
- **THEN** the verifier proceeds to similarity scoring

#### Scenario: Mismatched nonce rejected
- **WHEN** the agent response includes a nonce that does not match the issued nonce
- **THEN** the verifier rejects the session with a nonce mismatch error, regardless of similarity scores

### Requirement: Similarity scoring
The verifier SHALL compute the normalized Hamming similarity between each predicted signature and the corresponding real signature from the challenge database, then compute the mean across all 5 challenges.

#### Scenario: Similarity is computed correctly
- **WHEN** a predicted signature is compared to a real signature
- **THEN** similarity = `1 - (count_differing_bits(predicted, real) / 512)`

#### Scenario: Mean similarity is computed across all challenges
- **WHEN** all 5 similarities are computed
- **THEN** the session score is the arithmetic mean of the 5 individual similarities

### Requirement: Threshold acceptance
The verifier SHALL accept the identity claim if and only if the session score meets or exceeds the configured threshold.

#### Scenario: Score above threshold — accepted
- **WHEN** the mean similarity score is ≥ 0.78
- **THEN** the verifier returns `{ verified: true, score, session_id }`

#### Scenario: Score below threshold — rejected
- **WHEN** the mean similarity score is < 0.78
- **THEN** the verifier returns `{ verified: false, score, session_id }` and does NOT spend the challenges

### Requirement: Challenge spending on success
The verifier SHALL mark the 5 challenges as spent only after a successful (accepted) verification session.

#### Scenario: Challenges spent after acceptance
- **WHEN** a session is accepted (score ≥ threshold)
- **THEN** all 5 challenges used in that session are marked spent and will not be reissued

#### Scenario: Challenges not spent after rejection
- **WHEN** a session is rejected (score < threshold)
- **THEN** the 5 challenges remain unspent and may be reused in a future session

### Requirement: Session expiry
A verification session SHALL expire if the agent does not respond within 30 seconds of challenge issuance. Expired sessions SHALL release their challenges back to the unspent pool.

#### Scenario: Response within time window
- **WHEN** the agent responds within 30 seconds
- **THEN** the session proceeds to scoring normally

#### Scenario: Response after timeout
- **WHEN** no response is received within 30 seconds
- **THEN** the session is marked expired, the challenges are returned to the unspent pool, and the verifier returns a timeout error
