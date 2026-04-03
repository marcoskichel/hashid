## ADDED Requirements

### Requirement: On-chain operator registry
Each AVS operator SHALL register on-chain with their EigenLayer signing address, their AVS-specific Ed25519 public key, a public HTTPS endpoint URL, and a staked balance at or above the AVS minimum. An operator is eligible to participate in DKG ceremonies and signing sessions only if they appear in the registry with sufficient stake. Agents read the registry to discover operator endpoints for direct communication.

#### Scenario: Agent discovers operator endpoints
- **WHEN** an agent initiates a DKG ceremony or signing request
- **THEN** it reads the on-chain operator registry to obtain the endpoint URL and AVS Ed25519 public key for each eligible operator

#### Scenario: Unregistered operator responses are discarded
- **WHEN** a response arrives from an address not present in the on-chain operator registry
- **THEN** the agent discards the response and does not include it in any aggregation

#### Scenario: Under-staked operator is ineligible
- **WHEN** an operator's staked balance falls below the AVS minimum
- **THEN** the agent excludes that operator from VRF sampling; the operator is skipped as if absent from the registry

### Requirement: Operator-signed nonce commitments
Before sending Round 1 nonce commitments to the agent, each operator SHALL sign the commitment with its registered AVS Ed25519 key: `sign({ session_id, round_index, D_i, E_i, timestamp }, operator_avs_key)`. The signed commitment SHALL accompany the raw `(D_i, E_i)` values in the Round 1 response. The signature creates a non-repudiable record binding the operator to a specific nonce for a specific session and round.

#### Scenario: Operator sends signed nonce commitment in Round 1
- **WHEN** an operator completes nonce generation for Round 1
- **THEN** it sends `{ D_i, E_i, signature: sign({ session_id, round_index, D_i, E_i, timestamp }, avs_key) }` directly to the agent before any partial signature is computed

#### Scenario: Unsigned nonce commitment is rejected
- **WHEN** an operator sends a Round 1 nonce commitment without a valid AVS key signature
- **THEN** the agent rejects the commitment and excludes that operator from Round 2

### Requirement: EigenDA archival of signed nonce commitments
After collecting all K signed nonce commitments for a signing round, the agent SHOULD archive the complete set to EigenDA. The agent SHOULD record the resulting EigenDA record ID locally alongside the session ID and round index. Archived commitments are the source material for fraud proof submissions. The agent is not penalized for failure to archive, but cannot submit a nonce-reuse fraud proof for any round where commitments were not archived.

#### Scenario: Agent archives nonce commitments after Round 1
- **WHEN** K valid signed nonce commitments are collected for a round
- **THEN** the agent writes the commitment set to EigenDA and records the record ID locally

#### Scenario: EigenDA archival failure does not block signing
- **WHEN** the EigenDA write fails
- **THEN** the signing round proceeds normally; the agent logs the archival failure; fraud proofs for that round are unavailable

### Requirement: Lazy nonce-reuse fraud proof
The `SessionRegistry` contract SHALL expose a `slashNonceReuse(operator_id, signed_commitment_a, signed_commitment_b)` function. Each argument is a complete signed nonce commitment `{ session_id, round_index, D_i, E_i, timestamp, signature }`. The contract SHALL slash the operator if: both signatures verify under the operator's registered AVS Ed25519 key, both commitments contain identical `(D_i, E_i)` values, and the two commitments do not have both the same `session_id` and the same `round_index` (i.e., they are not the same commitment submitted twice).

#### Scenario: Cross-session nonce reuse triggers slashing
- **WHEN** `slashNonceReuse` is called with two valid operator-signed commitments with identical `(D_i, E_i)` and different `session_id` values
- **THEN** the contract verifies both signatures against the operator's registered AVS key and slashes the operator's EigenLayer stake

#### Scenario: Same-session cross-round nonce reuse triggers slashing
- **WHEN** `slashNonceReuse` is called with two valid operator-signed commitments with identical `(D_i, E_i)`, the same `session_id`, but different `round_index` values
- **THEN** the contract verifies both signatures and slashes the operator

#### Scenario: Identical commitment submitted twice is rejected
- **WHEN** `slashNonceReuse` is called with two commitments that have the same `session_id` and the same `round_index`
- **THEN** the contract reverts — a single commitment cannot prove reuse

#### Scenario: Mismatched operator keys are rejected
- **WHEN** `slashNonceReuse` is called with commitments whose signatures verify under different operator keys
- **THEN** the contract reverts with an operator-mismatch error

### Requirement: Operator rejection receipts
When an operator rejects a signing request for any reason (invalid auth token, challenge not in committed set, stake below minimum), the operator SHALL emit a signed rejection receipt `{ session_id, message_hash, reason, timestamp }` signed with its AVS Ed25519 key, and send it directly to the requesting agent. The agent SHOULD store rejection receipts locally alongside the session record.

#### Scenario: Rejection receipt sent on auth token failure
- **WHEN** an operator rejects a signing request due to an invalid or replayed auth token
- **THEN** the operator sends a signed rejection receipt to the agent with reason `"invalid-auth-token"` before any nonce material is generated

#### Scenario: Rejection receipt sent on challenge mismatch
- **WHEN** an operator rejects because `keccak256(raw_challenge)` is not in `session.challenge_hashes`
- **THEN** the operator sends a signed rejection receipt with reason `"challenge-not-committed"` to the agent

#### Scenario: Rejection receipt sent on insufficient stake
- **WHEN** an operator rejects because its staked balance is below the AVS minimum
- **THEN** the operator sends a signed rejection receipt with reason `"stake-below-minimum"` to the agent
