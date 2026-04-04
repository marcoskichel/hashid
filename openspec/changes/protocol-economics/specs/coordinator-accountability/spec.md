## MODIFIED Requirements

### Requirement: Minimum operator stake enforcement

Operators registering with the HashID AVS SHALL have a minimum restaked ETH balance in EigenLayer:

- **Baseline tier**: 50 ETH — applies to all operators; covers agents with asset value up to the baseline coverage ceiling
- **Financial tier**: 100 ETH — applies to operators serving agents with `minVerifierBond ≥ 0.5 ETH` declared in `AnchorIdentity`

`ServiceManager.registerOperator()` SHALL revert if the operator's EigenLayer restaked balance (verified via `DelegationManager.getOperatorShares()`) does not meet the applicable tier minimum at registration time. Under-staked operators cannot participate in DKG ceremonies or signing sessions regardless of other eligibility criteria.

#### Scenario: Under-staked operator registration is rejected
- **WHEN** an operator with 30 ETH restaked calls `registerOperator`
- **THEN** `ServiceManager` reverts with an insufficient-stake error; the operator is not added to the eligible set

#### Scenario: Financial-tier operator meets higher minimum
- **WHEN** an operator serving a financial-tier agent has 80 ETH restaked
- **THEN** `registerOperator` reverts; the operator must increase restaked ETH to 100 ETH before serving financial-tier agents

### Requirement: Slash amounts as compile-time constants

All slash amounts SHALL be compile-time constants in the contract bytecode. No governance setter, storage variable, or admin function controls slash amounts after deployment.

```solidity
uint256 private constant SLASH_NONCE_REUSE            = 75 ether;
uint256 private constant SLASH_BAD_SHARE               = 6 ether;
uint256 private constant SLASH_NON_ACKNOWLEDGMENT      = 0.1 ether;
uint256 private constant SLASH_NON_CONFIRMATION_BPS    = 500;   // 5% of operator stake in basis points
uint256 private constant SLASH_MISSING_DELETION_FIRST  = 1 ether;
uint256 private constant SLASH_MISSING_DELETION_REPEAT = 5 ether;
uint256 private constant SLASH_EQUIVOCATION_BPS        = 10000; // 100% of operator stake
uint256 private constant SLASH_ABANDONMENT_BPS         = 5000;  // 50% of verifier bond
```

`SLASH_NON_CONFIRMATION_BPS` and `SLASH_EQUIVOCATION_BPS` are applied as basis points of the operator's current staked balance at slash time (not a fixed ETH amount), so they scale with the operator's tier.

### Requirement: Escalating deletion attestation slash

The contract SHALL maintain `missedDeletionCount[operator_id]` tracking how many consecutive resharing epochs an operator has failed to submit a deletion attestation. The slash amount for `slashMissingDeletion` depends on this counter:

- 1st or 2nd consecutive miss: `SLASH_MISSING_DELETION_FIRST` (1 ETH)
- 3rd and subsequent consecutive misses: `SLASH_MISSING_DELETION_REPEAT` (5 ETH)

A successful deletion attestation submission resets `missedDeletionCount[operator_id]` to zero.

#### Scenario: Third consecutive missed deletion escalates slash
- **WHEN** `slashMissingDeletion` is called for an operator whose `missedDeletionCount` is 2 (third miss)
- **THEN** the contract slashes 5 ETH and increments `missedDeletionCount` to 3

#### Scenario: Successful attestation resets escalation counter
- **WHEN** an operator submits a valid deletion attestation after two prior misses
- **THEN** `missedDeletionCount[operator_id]` is set to 0; the next miss would slash at the 1 ETH rate

### Requirement: slashEquivocation — off-session co-signing

The AVS contract SHALL expose `slashEquivocation(operator_id, session_id_a, signed_payload_a, session_id_b, signed_payload_b)`. Off-session co-signing is the highest-value attack — an operator that co-signs a message traceable to no registered session has produced an unanchored signature, which is equivocation.

The contract SHALL slash 100% of the operator's staked balance (`SLASH_EQUIVOCATION_BPS = 10000`) if:

1. Both `signed_payload_a` and `signed_payload_b` contain valid Ed25519 signatures under the operator's registered AVS key
2. Both `session_id_a` and `session_id_b` can be verified against `SessionRegistry` (either OPEN or SPENT status)
3. The two signed payloads are for different sessions (`session_id_a != session_id_b`)

An operator that produces signatures for two different sessions is not necessarily equivocating — they may legitimately sign for multiple sessions sequentially. The equivocation case is narrower: a signature whose `session_id` is absent from `SessionRegistry` (no record exists) indicates an unanchored off-protocol signing event. The contract SHALL accept `session_id_b = bytes32(0)` to indicate "this signature has no corresponding session registration" — the absence of a session record is the proof of equivocation.

```
slashEquivocation(
    operator_id,
    session_id,          // the session this signature claims to be for
    signed_payload,      // the operator's signature and payload
    bytes32(0)           // signal: no session exists for this payload
)
```

In this variant, the contract verifies the signature is valid and checks `SessionRegistry.sessions[session_id]` does not exist (or the payload hash does not match any committed challenge in that session). If the check passes, the operator produced an authenticated signature for a non-existent or mismatched session — equivocation.

#### Scenario: Off-session signature with no registry record causes full slash
- **WHEN** `slashEquivocation` is called with a valid operator signature over a payload whose `session_id` has no corresponding `SessionRegistry` record
- **THEN** the contract verifies the signature under the operator's AVS key, confirms no session record exists for the claimed `session_id`, and slashes 100% of the operator's staked balance

#### Scenario: Valid inter-session signing does not trigger equivocation
- **WHEN** `slashEquivocation` is called with two valid signatures over two different sessions, both of which exist in `SessionRegistry` with status OPEN or SPENT
- **THEN** the contract reverts with a no-equivocation-evidence error; legitimate multi-session signing is not punishable

### Requirement: Operator participation rate and fee eligibility

The `ServiceManager` SHALL track per-operator session participation within rolling 30-day epochs:

- `sessionsAssigned[operator][epoch]`: count of sessions where the operator was in the VRF-sampled K
- `sessionsParticipated[operator][epoch]`: count of sessions where the operator submitted valid `acknowledgeSession` within the 2-minute window

At epoch close, the participation rate = `sessionsParticipated / sessionsAssigned`. Operators with participation rate < 95% are excluded from that epoch's Merkle reward root submitted to `RewardCoordinator`. They remain in the active operator set; this is a revenue exclusion, not a slashing or deregistration event.

Operators who fall below the 95% threshold for **3 consecutive epochs** SHALL be flagged in the registry with `lowParticipationFlag = true`. Protocol governance MAY remove flagged operators from the active set. Flagged operators remain eligible for slashing for prior misbehavior.

#### Scenario: Operator below 95% participation rate excluded from epoch rewards
- **WHEN** an epoch closes and `sessionsParticipated[operator][epoch] / sessionsAssigned[operator][epoch] = 0.92`
- **THEN** the operator is excluded from the epoch's reward Merkle root; other operators receive the excluded operator's share proportionally (or it accrues to treasury)

#### Scenario: Operator above threshold included at full weight
- **WHEN** participation rate = 0.97
- **THEN** the operator is included in the epoch reward root at full weight

### Requirement: Slash proceeds distribution

For every slash event, the recovered amount SHALL be distributed:

- **20%** to the address that submitted the valid slash proof (`msg.sender` of the slash function call)
- **30%** to `protocolTreasury` address
- **50%** to `address(0)` (burned)

This applies to all slash functions: `slashNonceReuse`, `slashBadShare`, `slashNonAcknowledgment`, `slashNonConfirmation`, `slashMissingDeletion`, `slashEquivocation`, `slashSessionAbandonment`.

The watcher reward SHALL be transferred atomically in the slash transaction via:

```solidity
uint256 watcherShare = slashAmount * 20 / 100;
uint256 treasuryShare = slashAmount * 30 / 100;
uint256 burned = slashAmount - watcherShare - treasuryShare;

payable(msg.sender).transfer(watcherShare);
payable(protocolTreasury).transfer(treasuryShare);
payable(address(0)).transfer(burned);

emit SlashDistributed(slashee, msg.sender, watcherShare, protocolTreasury, treasuryShare, burned);
```

The `SlashDistributed` event enables off-chain verification of correct distribution and provides the watcher market with a queryable audit trail.

The 20% watcher reward SHALL be documented in the contract NatSpec for every slash function and in the CLI help text for `hashid watch`. The CLI `hashid watch` command monitors for misbehavior events and automatically submits fraud proofs when evidence is detected, enabling operators of the agent to participate in the watcher market.

#### Scenario: Watcher receives 20% reward on successful slash
- **WHEN** any slash function is called with valid cryptographic evidence and a slash occurs
- **THEN** 20% of the slashed amount is transferred to `msg.sender` in the same transaction; `SlashDistributed` is emitted

#### Scenario: Slash distribution is correct for percentage-based slashes
- **WHEN** `slashNonConfirmation` is called for an operator with 50 ETH staked (5% slash = 2.5 ETH)
- **THEN** 0.5 ETH to watcher, 0.75 ETH to treasury, 1.25 ETH burned
