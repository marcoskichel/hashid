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
A registered verifier SHALL create a session by calling `initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)` on the `SessionRegistry` contract, where `challenge_hashes` is a `bytes32[5]` array of `keccak256` hashes of the five challenges the verifier intends to issue. The contract SHALL record `{ session_id, agent_pubkey, nonce, verifier_pubkey, challenge_hashes, control_pubkey, vrf_blockhash, status: OPEN, created_at }`, where `control_pubkey` is read from the AnchorIdentity record for `agent_pubkey` at the time `initSession` is called. The contract SHALL derive `session_id` as `keccak256(verifier_pubkey || agent_pubkey || nonce || blockhash(block.number - 1))`, where `block.number - 1` is the block immediately preceding the transaction's inclusion block. Using `blockhash(block.number)` is invalid in Solidity — it always returns zero within the same transaction; the valid range is `[block.number - 256, block.number - 1]`.

#### Scenario: Session is recorded on-chain
- **WHEN** `initSession` is called with valid parameters
- **THEN** a unique `session_id` is returned and the session is stored with `status: OPEN`; `control_pubkey` is snapshotted from the current AnchorIdentity record for `agent_pubkey` into the session; `vrf_blockhash` is stored as `blockhash(block.number - 1)` to enable future on-chain VRF membership verification

#### Scenario: Control key rotation does not invalidate open sessions
- **WHEN** `revealControlKeyRotation` is confirmed while one or more sessions for the agent are OPEN
- **THEN** those existing sessions retain their snapshotted `control_pubkey` and remain valid; only sessions initiated after the rotation use the new `control_pubkey`

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
The `SessionRegistry` contract SHALL atomically mark a session as `SPENT` when the final assembled signatures are submitted on-chain by the session's registered verifier via `spendSession(session_id, signatures[5])`. Only `session.verifier_address` MAY call `spendSession`; calls from any other address SHALL revert.

The contract SHALL enforce that `signatures` contains exactly 5 entries — one per committed challenge hash. For each index `i`, the contract SHALL verify `ed25519.verify(signatures[i], sha256(session.challenge_hashes[i] || session_id), session.agent_pubkey)` resolves to the agent's registered `group_pubkey`. If any of the 5 verifications fails, or if fewer than 5 signatures are supplied, the contract SHALL revert with a signature-verification-failed error and the session SHALL remain OPEN.

#### Scenario: Session is spent after all 5 signatures verify
- **WHEN** `spendSession` is called with exactly 5 valid Ed25519 signatures, each verifying against the corresponding committed challenge hash
- **THEN** the session status changes to `SPENT` and cannot be used again

#### Scenario: Fewer than 5 signatures causes revert
- **WHEN** `spendSession` is called with an array of fewer than 5 signatures
- **THEN** the contract reverts with a signature-count-mismatch error; the session remains OPEN

#### Scenario: Any invalid signature causes revert
- **WHEN** `spendSession` is called with 5 entries but one or more signatures fail Ed25519 verification against the committed challenge hashes
- **THEN** the contract reverts with a signature-verification-failed error; the session remains OPEN

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

### Requirement: Session abandonment tracking and slashing
The `SessionRegistry` contract SHALL track per-(verifier_address, agent_pubkey) expired session counts. A session is considered abandoned when it transitions from OPEN to expired without being spent. When a verifier accumulates 3 or more abandoned sessions against the same agent_pubkey within any rolling 60-minute window, any party MAY call `slashSessionAbandonment(verifier_address, agent_pubkey, session_ids[])`. The contract SHALL verify each session ID in the array was opened by the verifier for the agent, each has expired unspent, and all fall within the same 60-minute window. If all checks pass, the contract SHALL slash a portion of the verifier's bond.

This closes the monopolization attack where a small number of colluding registered verifiers repeatedly open and abandon sessions to saturate a target agent's session capacity.

#### Scenario: Abandonment threshold triggers slash eligibility
- **WHEN** a verifier has allowed 3 or more sessions against the same agent_pubkey to expire unspent within 60 minutes
- **THEN** any party may call `slashSessionAbandonment` with those session IDs as proof; the contract verifies the sessions, confirms they are expired and unspent, and slashes the verifier's bond

#### Scenario: Legitimate session expiry below threshold is not penalised
- **WHEN** a verifier opens sessions that expire unspent but the count is fewer than 3 against the same agent within 60 minutes
- **THEN** no slash is possible; normal session expiry is not punishable

#### Scenario: Slash proof requires sessions from the same verifier-agent pair
- **WHEN** `slashSessionAbandonment` is called with session IDs that mix different verifiers or different agent pubkeys
- **THEN** the contract reverts with an invalid-proof error

### Requirement: Session acknowledgment tracking and non-acknowledgment slashing
The `SessionRegistry` contract SHALL accept `acknowledgeSession(session_id, operator_id, sig)` calls within a 2-minute window from session creation. The contract SHALL verify that `sig` is a valid Ed25519 signature over `keccak256("ack" || session_id || operator_id)` under the operator's registered AVS key, and that the operator is in the VRF-sampled K for this session (computed on-chain using `keccak256(session_id || session.vrf_blockhash)`). Valid acknowledgments are recorded in the session record.

After the acknowledgment window closes, any party MAY call `slashNonAcknowledgment(session_id, operator_id)` if the operator was in the VRF-sampled K but submitted no acknowledgment within the window. The contract SHALL verify VRF membership on-chain using the stored `vrf_blockhash` and slash a portion of the operator's staked bond if the check passes.

#### Scenario: Valid acknowledgment is recorded
- **WHEN** a VRF-selected operator submits `acknowledgeSession` within 2 minutes with a valid AVS-key signature
- **THEN** the contract records the acknowledgment against the session/operator pair

#### Scenario: Unacknowledged VRF-selected operator is slashable
- **WHEN** the 2-minute acknowledgment window for a session has closed and a VRF-sampled operator has no recorded acknowledgment
- **THEN** any party may call `slashNonAcknowledgment(session_id, operator_id)`; the contract recomputes VRF membership from `session.session_id` and `session.vrf_blockhash`, confirms no acknowledgment exists, and slashes the operator's bond

#### Scenario: VRF membership is verified on-chain without off-chain proof
- **WHEN** `slashNonAcknowledgment` is called
- **THEN** the contract derives `vrf_seed = keccak256(session_id || session.vrf_blockhash)`, ranks all registered operators by `keccak256(vrf_seed || operator_id)`, and confirms the accused operator is among the K with the lowest values; no external witness or off-chain proof is required

#### Scenario: Acknowledged operator cannot be slashed for non-acknowledgment
- **WHEN** `slashNonAcknowledgment` is called for an operator that did submit a valid `acknowledgeSession` within the window
- **THEN** the contract reverts with an already-acknowledged error
