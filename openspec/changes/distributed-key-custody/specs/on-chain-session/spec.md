## ADDED Requirements

### Requirement: Verifier registration
A verifier SHALL register on-chain by staking a minimum bond before it is permitted to create verification sessions. Unregistered verifiers SHALL be rejected by the `SessionRegistry` contract.

#### Scenario: Registered verifier creates a session
- **WHEN** a registered, staked verifier calls `initSession`
- **THEN** the contract accepts the call and records the session

#### Scenario: Unregistered verifier is rejected
- **WHEN** an address with no staked bond calls `initSession`
- **THEN** the contract reverts with an unauthorized error

### Requirement: Session creation
A registered verifier SHALL create a session by calling `initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)` on the `SessionRegistry` contract, where `challenge_hashes` is a `bytes32[5]` array of `keccak256` hashes of the five challenges the verifier intends to issue. The contract SHALL record `{ session_id, agent_pubkey, nonce, verifier_pubkey, challenge_hashes, status: OPEN, created_at }`. The contract SHALL derive `session_id` as `keccak256(verifier_pubkey || agent_pubkey || nonce || blockhash(block.number - 1))`, where `block.number - 1` is the block immediately preceding the transaction's inclusion block. Using `blockhash(block.number)` is invalid in Solidity — it always returns zero within the same transaction; the valid range is `[block.number - 256, block.number - 1]`.

#### Scenario: Session is recorded on-chain
- **WHEN** `initSession` is called with valid parameters
- **THEN** a unique `session_id` is returned and the session is stored with `status: OPEN`

#### Scenario: Duplicate nonce is rejected
- **WHEN** a verifier calls `initSession` with a nonce already used in a prior session for the same agent
- **THEN** the contract reverts with a nonce-already-used error

#### Scenario: Challenge hashes are bound to the session
- **WHEN** `initSession` is called with `challenge_hashes`
- **THEN** `SessionRecord.challenge_hashes` stores the five `bytes32` values exactly as supplied and they cannot be modified after the transaction confirms

#### Scenario: Session ID is derived deterministically
- **WHEN** `initSession` is confirmed in block B
- **THEN** `session_id = keccak256(verifier_pubkey || agent_pubkey || nonce || blockhash(B - 1))` — unpredictable before the transaction lands and independently verifiable by any party afterward

### Requirement: Operator session verification
Before contributing a partial signature, an operator SHALL verify that `(agent_pubkey, session_id)` exists on-chain with `status: OPEN`.

#### Scenario: Open session allows signing
- **WHEN** an operator receives a signing request for an open session
- **THEN** it proceeds to partial signature computation

#### Scenario: Spent or unknown session blocks signing
- **WHEN** an operator receives a signing request for a session that does not exist or has `status: SPENT`
- **THEN** the operator refuses to produce a partial signature

### Requirement: Session spending
The `SessionRegistry` contract SHALL atomically mark a session as `SPENT` when the final assembled signature is submitted on-chain by the session's registered verifier. Only `session.verifier_address` MAY call `spendSession`; calls from any other address SHALL revert.

#### Scenario: Session is spent after successful signing
- **WHEN** the assembled Ed25519 signature is submitted to the contract
- **THEN** the session status changes to `SPENT` and cannot be used again

#### Scenario: Double-spend is rejected
- **WHEN** a second signature is submitted for an already-spent session
- **THEN** the contract reverts with a session-already-spent error

#### Scenario: Third-party spend attempt is rejected
- **WHEN** `spendSession` is called from an address other than `session.verifier_address`
- **THEN** the contract reverts with an unauthorized error

### Requirement: Session expiry
A session with `status: OPEN` that has not been spent within 30 minutes SHALL be automatically expired. Expired sessions SHALL release no spending rights and SHALL be ineligible for signing.

#### Scenario: Expired session is rejected by operator
- **WHEN** an operator receives a signing request for a session older than 30 minutes that is still OPEN
- **THEN** the operator treats it as invalid and refuses to sign

#### Scenario: Expired session cannot be spent
- **WHEN** a signature is submitted for an expired session
- **THEN** the contract reverts with a session-expired error

### Requirement: Per-verifier rate limiting
The `SessionRegistry` contract SHALL enforce a maximum of 10 open sessions per verifier at any time.

#### Scenario: Rate limit is enforced
- **WHEN** a verifier already has 10 open sessions and calls `initSession`
- **THEN** the contract reverts with a rate-limit-exceeded error

#### Scenario: Closing sessions restores capacity
- **WHEN** one of the verifier's open sessions is spent or expires
- **THEN** the verifier may create a new session up to the limit

### Requirement: VRF seed derivation
The VRF seed for operator sampling SHALL be derived as `keccak256(session_id || blockhash(block.number - 1))` where `block.number - 1` is the block immediately preceding the block in which `initSession` was confirmed. The coordinator SHALL NOT supply any component of the VRF seed. The seed SHALL be computable by any party from on-chain data alone.

#### Scenario: VRF seed is deterministic from on-chain data
- **WHEN** `initSession` is confirmed in block B
- **THEN** the VRF seed is `keccak256(session_id || blockhash(B - 1))`, computable independently by operators and the agent

#### Scenario: Coordinator cannot bias operator selection
- **WHEN** the coordinator performs VRF sampling
- **THEN** it uses the on-chain-derived seed; any deviation from this seed is detectable by operators who independently verify the sampled set

### Requirement: Per-agent session rate limiting
The `SessionRegistry` contract SHALL enforce a maximum of `N × 2` concurrent OPEN sessions per `agent_pubkey` across all verifiers, where N is the current registered operator count. If this limit is exceeded, `initSession` SHALL revert with an agent-session-limit-exceeded error regardless of the calling verifier.

#### Scenario: Per-agent limit prevents operator network saturation
- **WHEN** an agent already has `N × 2` open sessions across all verifiers and any verifier calls `initSession` for that agent
- **THEN** the contract reverts with an agent-session-limit-exceeded error

#### Scenario: Spent or expired sessions restore per-agent capacity
- **WHEN** one of an agent's open sessions becomes SPENT or expires
- **THEN** the per-agent open session count decreases and a new session for that agent may be created
