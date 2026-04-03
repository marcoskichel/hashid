## ADDED Requirements

### Requirement: FROST resharing for share compromise
When a key share is suspected compromised, the system SHALL trigger FROST resharing (ProactiveSS). Resharing SHALL produce a new set of N valid shares. Old shares SHALL be cryptographically invalidated. The group public key SHALL remain unchanged.

#### Scenario: Resharing produces the same public key
- **WHEN** FROST resharing completes
- **THEN** the group public key is identical before and after

#### Scenario: Old shares are rejected after resharing
- **WHEN** an operator with an old (pre-resharing) share attempts to contribute a partial signature
- **THEN** the aggregation rejects the partial signature as belonging to an invalid share epoch

#### Scenario: Resharing does not require verifier updates
- **WHEN** FROST resharing completes
- **THEN** verifiers continue to verify against the same on-chain public key without any chain update

### Requirement: Resharing two-phase confirmation protocol
FROST resharing SHALL use a two-phase protocol to prevent permanent key loss if the ceremony is interrupted.

**Phase 1 (Distribute):** New shares are generated and distributed to all N operators. Old shares remain valid during this phase. No operator SHALL delete its old share until Phase 2 completes.

**Phase 2 (Confirm):** Each operator, upon successfully receiving and validating its new share, SHALL submit a signed confirmation `{ operator_id, new_epoch, action: "share_received", timestamp }` to the coordinator. Old shares are cryptographically invalidated ONLY after all N operators have submitted confirmations.

If all N confirmations are not received within 30 minutes of Phase 1 completion, the ceremony is aborted. Old shares remain valid. No share is deleted. The resharing must be restarted with a new session.

The coordinator SHALL NOT signal ceremony completion to any operator until all N confirmations are received.

#### Scenario: Old shares survive until all N operators confirm
- **WHEN** a resharing ceremony is in progress and fewer than N operators have submitted Phase 2 confirmations
- **THEN** all operators retain their old shares as valid; no partial invalidation occurs

#### Scenario: Resharing aborts if confirmation timeout elapses
- **WHEN** 30 minutes elapse after Phase 1 without all N Phase 2 confirmations
- **THEN** the coordinator broadcasts a ceremony abort; all operators discard their new shares and retain old shares; the epoch counter does not advance

#### Scenario: Non-confirmation within timeout is slashable
- **WHEN** 30 minutes elapse after Phase 1 completion without a Phase 2 confirmation from a specific operator
- **THEN** any party may submit `slashNonConfirmation(operator_id, epoch, signed_share_receipt)` on-chain, where `signed_share_receipt` is the operator's signed acknowledgement of receiving their Phase 1 share; the contract verifies the receipt and slashes the operator's EigenLayer stake

#### Scenario: Old shares invalidated only after unanimous confirmation
- **WHEN** all N operators have submitted valid Phase 2 confirmations
- **THEN** the coordinator signals completion; operators invalidate old shares; the epoch counter advances

### Requirement: Share deletion attestation
After resharing ceremony completion (all N Phase 2 confirmations received), each operator SHALL submit a signed deletion attestation within 24 hours: `sign({ operator_id, old_epoch, action: "shares_deleted", timestamp }, operator_key)`. The coordinator SHALL include all deletion attestations in the next `publishNonceRoot` call. Failure to submit a deletion attestation within 24 hours of resharing confirmation SHALL be a slashable condition.

#### Scenario: Deletion attestation is submitted and logged
- **WHEN** an operator deletes its old-epoch shares after resharing
- **THEN** it submits a signed attestation to the coordinator within 24 hours; the coordinator includes it in the next Merkle root publication

#### Scenario: Missing deletion attestation is slashable
- **WHEN** 24 hours elapse after resharing confirmation without a deletion attestation from an operator
- **THEN** any party may submit a `slashMissingDeletion(operator_id, epoch, merkle_proof_of_resharing_completion)` proof on-chain to slash the operator

#### Scenario: Deletion attestation epoch matches resharing epoch
- **WHEN** a deletion attestation is submitted with an epoch that does not match the completed resharing epoch
- **THEN** the attestation is rejected as invalid

### Requirement: Phase 2 non-confirmation slashing
The AVS contract SHALL expose a `slashNonConfirmation(operator_id, epoch, signed_share_receipt)` function. The `signed_share_receipt` is a signed message `{ operator_id, epoch, action: "share_received", timestamp }` produced by the operator upon receiving their Phase 1 share, establishing that the operator received and acknowledged its new share. If the operator signed a receipt but did not submit a Phase 2 confirmation within 30 minutes of receipt, this receipt combined with the absence of an on-chain confirmation record is conclusive evidence of non-confirmation. The contract SHALL slash the operator if: the receipt signature verifies under the operator's registered AVS key, the epoch matches a completed Phase 1 with no corresponding Phase 2 confirmation from that operator, and 30 minutes have elapsed since the receipt timestamp.

#### Scenario: Valid non-confirmation proof triggers slashing
- **WHEN** `slashNonConfirmation` is called with a valid signed share receipt and no Phase 2 confirmation exists for that operator and epoch after 30 minutes
- **THEN** the contract verifies the receipt signature and slashes the operator's EigenLayer stake

#### Scenario: Operator that confirmed on time cannot be slashed
- **WHEN** `slashNonConfirmation` is called for an operator that did submit a Phase 2 confirmation within the window
- **THEN** the contract reverts with a confirmation-exists error

### Requirement: Full keypair succession — commit phase
When a full keypair rotation is needed, the initiating party SHALL submit a commitment `keccak256(agent_id || old_pubkey || new_pubkey || salt)` to the `SuccessionRegistry` contract. The contract SHALL record the commitment and the committing address. The `new_pubkey` is not revealed on-chain during this phase. A commitment expires automatically after 48 hours if not revealed. After expiry, a new commitment may be submitted (subject to the 1-hour minimum between commits).

#### Scenario: Commitment is recorded
- **WHEN** `commitSuccession(commitment)` is called by the agent or its delegate
- **THEN** the contract stores `{ committing_address, commitment, committed_at }` and emits a `SuccessionCommitted` event

#### Scenario: Only the committing address can reveal
- **WHEN** `revealSuccession` is called from an address other than the one that committed
- **THEN** the contract reverts with an unauthorized error

#### Scenario: Commitment expires after 48 hours
- **WHEN** 48 hours elapse after `commitSuccession` without a corresponding `revealSuccession`
- **THEN** the commitment is automatically invalidated; the agent may submit a new commitment after the 1-hour minimum interval

#### Scenario: Agent cancels a pending commitment via control key
- **WHEN** the agent calls `cancelCommitment(agent_id, auth_token)` where `auth_token` is a valid agent control key signature over `(agent_id || commitment_hash)`
- **THEN** the pending commitment is immediately cancelled without waiting for the 48-hour expiry; a new commitment may be submitted after the 1-hour minimum interval

### Requirement: Full keypair succession — reveal phase and 24-hour timelock
After the commitment is recorded, the committing address SHALL wait a mandatory 24-hour delay before calling `revealSuccession(agent_id, old_pubkey, new_pubkey, salt)`. The contract SHALL verify `keccak256(agent_id || old_pubkey || new_pubkey || salt)` matches the stored commitment, verify the Ed25519 signature from the old group key over `{ new_pubkey, timestamp }`, then write the succession entry.

#### Scenario: Reveal before 24-hour window is rejected
- **WHEN** `revealSuccession` is called fewer than 24 hours after the commitment
- **THEN** the contract reverts with a timelock-not-elapsed error

#### Scenario: Succession entry is written after reveal
- **WHEN** `revealSuccession` is called after 24 hours with a valid commitment and valid old-key signature
- **THEN** `{ new_pubkey, timestamp, reason, signature }` is recorded on-chain and the old pubkey is marked superseded

#### Scenario: Succession signature is verifiable
- **WHEN** a verifier reads a succession entry
- **THEN** `ed25519.verify(signature, hash({ new_pubkey, timestamp, reason }), old_pubkey)` returns true

#### Scenario: Old key shares are invalidated after succession
- **WHEN** the succession entry is confirmed on-chain
- **THEN** the AVS contract marks the old pubkey as superseded; operators delete their old shares

### Requirement: Guardian veto during timelock window
If a guardian address is registered on the agent's identity record, the guardian MAY call `vetoSuccession(agent_id)` at any time between commitment and reveal. A successful veto permanently cancels the pending commitment; the initiating party must start a new commitment cycle.

#### Scenario: Guardian vetoes within the window
- **WHEN** the registered guardian calls `vetoSuccession` before the reveal is submitted
- **THEN** the pending commitment is deleted and a `SuccessionVetoed` event is emitted; no succession entry is written

#### Scenario: Veto by non-guardian is rejected
- **WHEN** an address that is not the registered guardian calls `vetoSuccession`
- **THEN** the contract reverts with an unauthorized error

#### Scenario: Veto after reveal has no effect
- **WHEN** `vetoSuccession` is called after `revealSuccession` has already been confirmed
- **THEN** the contract reverts with a no-pending-commitment error

### Requirement: Succession rate limiting
The `SuccessionRegistry` contract SHALL enforce: (1) a minimum of 1 hour between successive `commitSuccession` calls for the same agent, and (2) a maximum chain length of 100 succession entries per agent.

#### Scenario: Rapid re-commit is rejected
- **WHEN** `commitSuccession` is called for an agent whose last commitment was fewer than 1 hour ago
- **THEN** the contract reverts with a rate-limit-exceeded error

#### Scenario: Chain length limit is enforced
- **WHEN** an agent's succession chain has reached 100 entries and `commitSuccession` is called
- **THEN** the contract reverts with a chain-length-exceeded error

### Requirement: Guardian rotation
The registered guardian address MAY be rotated using the same commit-reveal + 24-hour timelock as keypair succession. The commitment SHALL be `keccak256(agent_id || old_guardian || new_guardian || salt)`. The reveal SHALL be callable only by the current guardian or the agent's signing key. The 24-hour timelock and rate limiting rules apply identically.

#### Scenario: Guardian rotation uses the same timelock
- **WHEN** a guardian rotation commitment is submitted and the 24-hour window elapses without veto
- **THEN** the registered guardian address is updated to the new address

#### Scenario: Guardian rotation can be vetoed by the current guardian
- **WHEN** the current guardian calls `vetoGuardianRotation` within the 24-hour window
- **THEN** the pending guardian rotation commitment is cancelled

### Requirement: Emergency guardian rotation via K-of-N threshold endorsement
When the registered guardian address is known or suspected compromised, the agent MAY rotate the guardian immediately — bypassing the 24-hour timelock and the current guardian's veto capability — by submitting a K-of-N FROST threshold endorsement. The agent requests K-of-N current operators to threshold-sign `{ agent_id, new_guardian_address, timestamp }` and submits the assembled signature to `rotateGuardianWithEndorsement(agent_id, new_guardian_address, timestamp, threshold_signature)` on-chain. The contract verifies the threshold signature against the agent's registered `group_pubkey` and updates the guardian address immediately. The current guardian CANNOT veto this path.

This path is the recovery mechanism when an attacker has stolen the guardian key: a compromised guardian key alone cannot authorize this rotation (K-of-N operator cooperation is required), so the attacker cannot use a stolen key to block the legitimate agent from replacing the guardian.

#### Scenario: Emergency guardian rotation completes immediately
- **WHEN** `rotateGuardianWithEndorsement` is called with a valid K-of-N threshold signature over `{ agent_id, new_guardian_address, timestamp }`
- **THEN** the contract verifies the signature against `group_pubkey`, updates the registered guardian address immediately, and emits a `GuardianRotatedByEndorsement` event; no 24-hour timelock applies

#### Scenario: Stolen guardian key cannot block emergency rotation
- **WHEN** the current guardian key is held by an attacker who calls `vetoGuardianRotation`
- **THEN** the veto has no effect on a pending `rotateGuardianWithEndorsement` call; the threshold-endorsed rotation completes regardless

#### Scenario: Emergency rotation without valid threshold signature is rejected
- **WHEN** `rotateGuardianWithEndorsement` is called with a signature that does not verify against `group_pubkey`
- **THEN** the contract reverts; the guardian address is unchanged

#### Scenario: Expired endorsement is rejected
- **WHEN** `rotateGuardianWithEndorsement` is called with a `timestamp` more than 1 hour old
- **THEN** the contract reverts with an endorsement-expired error; the agent must obtain a fresh threshold signature

### Requirement: Guardian term expiry and mandatory renewal
A guardian address is registered with a 6-month term. Before the term expires, the guardian SHALL sign and submit a renewal transaction to extend their guardianship for another 6-month term. If the guardian term expires without renewal, the guardianship lapses: succession commitments proceed with the 24-hour timelock only, with no veto capability, until a new guardian is registered.

A new guardian MAY be registered at any time using the same commit-reveal + 24-hour timelock path as guardian rotation. Registering a new guardian after term expiry is subject to normal rate limiting (1-hour minimum between commits).

#### Scenario: Active guardian can veto within their term
- **WHEN** a guardian's term is active (not expired)
- **THEN** the guardian retains full veto capability over succession commitments

#### Scenario: Expired guardian has no veto capability
- **WHEN** a guardian's 6-month term has elapsed without renewal
- **THEN** succession commitments are subject only to the 24-hour timelock; the expired guardian address cannot veto

#### Scenario: Guardian renewal extends the term
- **WHEN** a guardian signs and submits a renewal transaction before their term expires
- **THEN** the term is extended by 6 months from the renewal date

#### Scenario: Lapsed guardian can be replaced without veto
- **WHEN** a guardian's term has expired
- **THEN** the agent may register a new guardian via commit-reveal; the expired guardian cannot veto this registration

### Requirement: Control key rotation with group key succession
When a full keypair succession occurs, the agent SHALL generate a new control key pair alongside the new FROST DKG ceremony. The new `control_pubkey` SHALL be included in the `revealSuccession` call and registered on-chain atomically with the new `group_pubkey`. The succession commitment SHALL cover both keys: `keccak256(agent_id || old_group_pubkey || new_group_pubkey || old_control_pubkey || new_control_pubkey || salt)`. The old control private key SHALL be destroyed after the succession entry is confirmed on-chain.

#### Scenario: Control key and group key rotate atomically
- **WHEN** `revealSuccession` is confirmed on-chain
- **THEN** both the new `group_pubkey` and new `control_pubkey` are registered together; the old control key cannot authorize any further signing requests

#### Scenario: Old control key is rejected after succession
- **WHEN** a signing request arrives with an auth token signed by the old control key after succession is confirmed
- **THEN** operators reject the request because the on-chain `control_pubkey` for the agent has changed

#### Scenario: Succession commitment covers both keys
- **WHEN** `commitSuccession` is submitted
- **THEN** the commitment hash includes both old and new control public keys alongside old and new group public keys; neither key can be changed during the 24-hour window without invalidating the commitment

### Requirement: Standalone control key rotation
When the agent's control key is suspected compromised (e.g., agent machine stolen) but the FROST group key shares are unaffected, the agent SHALL be able to rotate only the control key without triggering a full DKG ceremony. This path uses a threshold-endorsed commit-reveal flow:

**Commit phase:** The agent submits `commitControlKeyRotation(keccak256(agent_id || old_control_pubkey || new_control_pubkey || salt))` to the `SuccessionRegistry` contract. The contract records the commitment with a 24-hour timelock.

**Endorse phase:** The agent requests K-of-N operators to threshold-sign the rotation payload `{ agent_id, new_control_pubkey, timestamp }`. The resulting FROST signature proves that the legitimate key-holder (whose signing capacity operators protect) endorses the new control key.

**Reveal phase:** After 24 hours, the agent calls `revealControlKeyRotation(agent_id, old_control_pubkey, new_control_pubkey, salt, threshold_signature)`. The contract verifies `keccak256(agent_id || old_control_pubkey || new_control_pubkey || salt)` matches the commitment, verifies the FROST threshold signature over the rotation payload, then updates the on-chain `control_pubkey` for the agent. The old control private key SHALL be destroyed after the reveal is confirmed.

The same 24-hour timelock, guardian veto, 1-hour minimum between commits, and rate-limiting rules that apply to full keypair succession apply identically here.

#### Scenario: Standalone control key rotation completes
- **WHEN** `revealControlKeyRotation` is confirmed on-chain after 24 hours with a valid commitment and valid threshold signature
- **THEN** the on-chain `control_pubkey` is updated; the old control key is immediately rejected by operators for all new signing requests

#### Scenario: Threshold signature is required for control key rotation
- **WHEN** `revealControlKeyRotation` is called without a valid K-of-N FROST threshold signature over the rotation payload
- **THEN** the contract reverts; the old control key remains active

#### Scenario: Guardian may veto standalone control key rotation
- **WHEN** the registered guardian calls `vetoSuccession` (which covers both succession and control-key-rotation commitments) before the reveal
- **THEN** the pending control key rotation commitment is cancelled

#### Scenario: Old control key is rejected after standalone rotation
- **WHEN** a signing request arrives with an auth token signed by the old control key after `revealControlKeyRotation` is confirmed
- **THEN** operators reject the request because the on-chain `control_pubkey` has changed

### Requirement: Succession chain traversal
A verifier SHALL be able to find the current active public key for an agent by starting from the initial on-chain anchor and following succession entries until it reaches a key with no successor.

#### Scenario: Chain leads to the current active key
- **WHEN** a verifier walks the succession chain from the initial anchor
- **THEN** it arrives at the most recent pubkey with no outgoing succession entry

#### Scenario: Circular succession is rejected
- **WHEN** walking the succession chain produces a cycle
- **THEN** the verifier rejects the chain as invalid

### Requirement: Succession chain is append-only
Once a succession entry is written on-chain, it SHALL NOT be modifiable or deletable. The chain SHALL only grow by appending new entries.

#### Scenario: Succession entry cannot be modified
- **WHEN** any party attempts to alter a published succession entry
- **THEN** the on-chain contract rejects the modification

#### Scenario: New succession entry is appended correctly
- **WHEN** a new succession ceremony completes
- **THEN** the new entry references the previous pubkey as its predecessor and is appended to the chain
