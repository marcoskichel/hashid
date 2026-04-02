## ADDED Requirements

### Requirement: Nonce commitment log
The AVS Coordinator SHALL maintain an append-only log of nonce commitments for every signing round. Each log entry SHALL contain `{ operator_id, session_id, round_index, D_i, E_i, z_i, epoch, timestamp }`. Entries SHALL be appended immediately upon receipt of each partial signature and SHALL never be deleted or modified.

#### Scenario: Log entry is appended per partial signature
- **WHEN** the coordinator receives a partial signature `(operator_id, partial_sig)` from an operator
- **THEN** it appends `{ operator_id, session_id, round_index, D_i, E_i, z_i, epoch, timestamp }` to the nonce commitment log before aggregating or forwarding the partial signature

#### Scenario: Rejection receipts are logged
- **WHEN** an operator emits a signed rejection receipt `{ session_id, message_hash, challenge_hash, round, timestamp }`
- **THEN** the coordinator appends the rejection receipt to the nonce commitment log and includes it in the next Merkle root publication

#### Scenario: Log is append-only
- **WHEN** any party attempts to modify or delete a log entry
- **THEN** the modification fails; the log only accepts new appends

### Requirement: On-chain Merkle root publication
After each completed signing round (successful or failed), the coordinator SHALL compute a Merkle root over all new log entries for that round and publish it to the `SessionRegistry` contract by calling `publishNonceRoot(epoch, merkle_root)`. The epoch counter SHALL increment monotonically with each publication.

#### Scenario: Merkle root is published after each round
- **WHEN** a signing round completes (K partial signatures received or the 5-minute timeout elapses)
- **THEN** the coordinator calls `publishNonceRoot` with the current epoch and the Merkle root of all new log entries

#### Scenario: Epoch counter increments monotonically
- **WHEN** `publishNonceRoot` is called with an epoch value less than or equal to the last recorded epoch
- **THEN** the contract reverts with an invalid-epoch error

### Requirement: Operator inclusion confirmation before next round
After the coordinator calls `publishNonceRoot(epoch, merkle_root)`, it SHALL provide each operator with a Merkle inclusion proof for their log entry from that epoch. Each operator SHALL independently verify `keccak256(their_log_entry) ∈ merkle_root` before generating nonce material for any subsequent signing round. An operator that cannot verify its inclusion SHALL refuse to participate in the next round and SHALL emit a signed non-inclusion complaint.

#### Scenario: Operator verifies inclusion before next round
- **WHEN** the coordinator publishes a Merkle root for epoch E
- **THEN** each operator verifies its Round E entry is included in the root before accepting any Round E+1 signing request

#### Scenario: Missing inclusion proof blocks operator participation
- **WHEN** an operator does not receive a valid inclusion proof for its prior round entry
- **THEN** it refuses to generate nonce material for the next round and emits a signed non-inclusion complaint identifying the missing epoch and session

#### Scenario: Coordinator cannot silently drop log entries
- **WHEN** the coordinator omits an operator's entry from the Merkle root
- **THEN** that operator detects the omission, refuses the next round, and the complaint is recorded — the coordinator cannot proceed without either including the entry or facing an operator refusal

### Requirement: Nonce reuse slashing
The `SessionRegistry` contract SHALL expose a `slashNonceReuse(operator_id, proof_a, proof_b)` function. Each proof is a Merkle inclusion proof demonstrating that a specific `(operator_id, D_i, E_i)` tuple appears in the nonce commitment log. If the two proofs reference the same `(D_i, E_i)` values under different `session_id` values, the proofs are conclusive evidence of nonce reuse and the contract SHALL slash the operator. No Ed25519 arithmetic is required on-chain — the check requires only keccak256 verification of the Merkle paths.

#### Scenario: Valid nonce reuse proof triggers slashing
- **WHEN** `slashNonceReuse` is called with two valid Merkle inclusion proofs showing identical `(D_i, E_i)` for the same `operator_id` across two different `session_id` values
- **THEN** the contract verifies both Merkle paths against their respective published roots and slashes the operator's EigenLayer stake

#### Scenario: Proof with mismatched operator is rejected
- **WHEN** `slashNonceReuse` is called with two proofs where the `operator_id` fields differ
- **THEN** the contract reverts with an operator-mismatch error

#### Scenario: Invalid Merkle proof is rejected
- **WHEN** either inclusion proof fails Merkle path verification against the stored root
- **THEN** the contract reverts with an invalid-proof error

### Requirement: Same-session nonce reuse slashing
The `SessionRegistry` contract SHALL expose a `slashNonceReuseInSession(operator_id, session_id, round_index_1, round_index_2, D_i, E_i, proof_1, proof_2)` function. Each proof is a Merkle inclusion proof demonstrating that the same `(operator_id, D_i, E_i)` tuple appears in two different round entries within the same `session_id`. If the two proofs reference identical `(D_i, E_i)` with `round_index_1 ≠ round_index_2`, the contract SHALL slash the operator. A session has 5 signing rounds; reusing a nonce across any two rounds is as exploitable as cross-session reuse.

#### Scenario: Valid same-session nonce reuse proof triggers slashing
- **WHEN** `slashNonceReuseInSession` is called with two valid Merkle proofs showing identical `(D_i, E_i)` for the same operator in two different rounds of the same session
- **THEN** the contract verifies both paths against the published root and slashes the operator

#### Scenario: Same round index is rejected
- **WHEN** `slashNonceReuseInSession` is called with `round_index_1 == round_index_2`
- **THEN** the contract reverts with a same-round error

### Requirement: Coordinator message substitution detection
When an operator rejects a signing request because the challenge does not appear in `session.challenge_hashes` (see threshold-signing Round 1 pre-check), the operator SHALL emit a signed rejection receipt containing `{ session_id, message_hash, challenge_hash, round: "1", timestamp }`. The coordinator SHALL record this receipt in the nonce commitment log. The receipt is cryptographic evidence that the coordinator attempted to route an uncommitted challenge.

#### Scenario: Rejection receipt is published in next Merkle root
- **WHEN** the coordinator receives a signed rejection receipt from an operator
- **THEN** the receipt is included in the nonce commitment log and its hash appears in the next `publishNonceRoot` call

#### Scenario: Multiple rejection receipts from the same session are individually logged
- **WHEN** multiple operators reject the same signing request in Round 1
- **THEN** each operator's rejection receipt is appended as a separate log entry; all are included in the Merkle root

### Requirement: VRF proof publication in signing session record
After performing VRF-based operator sampling for a signing session, the coordinator SHALL append a VRF session record `{ session_id, vrf_seed, selected_operators, vrf_proof }` to the nonce commitment log. Each sampled operator SHALL verify `vrf_verify(vrf_seed, vrf_proof) → selected_operators` before generating nonce material. If the vrf_proof is absent, malformed, or does not produce the claimed operator set, the operator SHALL refuse to participate and SHALL emit a signed rejection receipt.

#### Scenario: Operator verifies VRF proof before signing
- **WHEN** an operator receives a signing request for a session
- **THEN** it verifies the VRF proof in the session record confirms it was legitimately sampled before generating any nonce material

#### Scenario: Invalid VRF proof blocks operator participation
- **WHEN** an operator cannot verify the VRF proof or is not in the claimed selected set
- **THEN** it refuses the signing request and emits a signed rejection receipt; no nonce material is generated

#### Scenario: VRF session record is included in Merkle root
- **WHEN** the coordinator publishes `publishNonceRoot` after the round
- **THEN** the VRF session record for that round is included in the log and its hash appears in the Merkle root

### Requirement: Coordinator bond and slashCoordinator
The AVS Coordinator SHALL stake a bond at AVS registration time. The `SessionRegistry` contract SHALL expose a `slashCoordinator(session_id, rejection_receipts[])` function. When `ceil(K/2)` or more distinct signed rejection receipts for the same `session_id` are presented — each a valid Ed25519 signature under a distinct registered operator key — the contract SHALL slash a portion of the coordinator's bond.

#### Scenario: Threshold of rejection receipts triggers coordinator slash
- **WHEN** `slashCoordinator` is called with `ceil(K/2)` or more valid, distinct operator rejection receipts for the same session
- **THEN** the contract verifies each receipt signature against the respective operator's registered key and slashes the coordinator's bond

#### Scenario: Insufficient rejection receipts are rejected
- **WHEN** `slashCoordinator` is called with fewer than `ceil(K/2)` valid receipts
- **THEN** the contract reverts with an insufficient-evidence error

#### Scenario: Duplicate operator receipts do not count
- **WHEN** `slashCoordinator` is called with two receipts from the same operator for the same session
- **THEN** only one is counted toward the threshold; duplicates are ignored

#### Scenario: Coordinator without registered bond cannot be slashed
- **WHEN** a coordinator registers with the AVS without staking a bond
- **THEN** the AVS contract rejects the registration
