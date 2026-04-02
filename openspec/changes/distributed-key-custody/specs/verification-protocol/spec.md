## REMOVED Requirements

### Requirement: Similarity scoring
**Reason**: LoRA biometric approach eliminated. There are no predicted signatures to compare against real signatures.
**Migration**: Verifier scoring logic replaced by Ed25519 signature verification.

### Requirement: Threshold acceptance
**Reason**: Score-based acceptance replaced by cryptographic signature verification. Verification is binary — the signature either verifies or it does not.
**Migration**: Verifier accept/reject logic updated to call `ed25519.verify`.

### Requirement: Challenge spending on success
**Reason**: Challenge database eliminated. The on-chain session nonce is the single-use spending mechanism.
**Migration**: On-chain session spending (status: SPENT) replaces challenge spending.

## MODIFIED Requirements

### Requirement: Session initiation
A verification session SHALL begin with the verifier selecting 5 challenge strings from the genesis corpus, computing `keccak256(challenge)` for each to form `challenge_hashes: bytes32[5]`, and calling `initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)` on the `SessionRegistry` contract. The verifier SHALL NOT send the raw challenge strings to the agent until the `initSession` transaction is confirmed on-chain. This ordering ensures the coordinator cannot substitute a different message after the operator has committed nonces.

#### Scenario: Challenges are selected and hashed before initSession
- **WHEN** a verification session starts
- **THEN** the verifier selects 5 challenges, computes their keccak256 hashes, and submits those hashes in `initSession` before sending any raw challenge data to the agent

#### Scenario: Session is registered on-chain before challenges are sent
- **WHEN** `initSession` is confirmed on-chain
- **THEN** the verifier sends the raw challenge strings to the agent; challenges are never sent before the on-chain confirmation

#### Scenario: Correct number of challenges issued
- **WHEN** a session is initiated
- **THEN** exactly 5 challenge strings from the genesis corpus are sent to the agent, matching the 5 hashes committed in `initSession`

### Requirement: Agent response
The agent SHALL respond to each challenge by coordinating a threshold signing ceremony and returning the assembled Ed25519 signature over the challenge data.

#### Scenario: Agent returns one signature per challenge
- **WHEN** the agent receives a batch of 5 challenges
- **THEN** it returns exactly 5 Ed25519 signatures, one per challenge, in the same order

#### Scenario: Agent includes session ID in signing payload
- **WHEN** the agent signs a challenge
- **THEN** the signed payload is `{ challenge, session_id }` — the session ID is bound into the signature

### Requirement: Session nonce validation
The verifier SHALL reject any response where the session ID does not match the registered on-chain session.

#### Scenario: Matching session accepted
- **WHEN** the agent response references the correct on-chain session ID
- **THEN** the verifier proceeds to signature verification

#### Scenario: Mismatched session rejected
- **WHEN** the agent response references a session ID that does not match the registered session
- **THEN** the verifier rejects with a session-mismatch error

## ADDED Requirements

### Requirement: Threshold signature verification
The verifier SHALL verify each returned Ed25519 signature against the agent's on-chain public key. All 5 signatures MUST verify for the session to be accepted.

#### Scenario: All signatures verify — session accepted
- **WHEN** all 5 signatures verify with `ed25519.verify(sig, { challenge, session_id }, agent_pubkey)`
- **THEN** the verifier returns `{ verified: true, session_id }`

#### Scenario: Any signature fails — session rejected
- **WHEN** any of the 5 signatures fails Ed25519 verification
- **THEN** the verifier returns `{ verified: false, session_id, reason: "signature-invalid" }` and does NOT spend the session

### Requirement: On-chain session spending on success
After all 5 signatures verify, the verifier SHALL submit the assembled signatures to the `SessionRegistry` contract to mark the session as SPENT.

#### Scenario: Session is spent after successful verification
- **WHEN** all 5 signatures verify
- **THEN** the verifier submits the signatures on-chain and the session status becomes SPENT

#### Scenario: Session is not spent after failed verification
- **WHEN** verification fails
- **THEN** the session remains OPEN and may be used for a retry within the session expiry window

### Requirement: Partial session completion and expiry
If fewer than all 5 signatures are assembled within the session expiry window (30 minutes from `initSession`), the session expires with status OPEN. No partial credit is awarded — all 5 signatures MUST verify within a single session lifetime for the session to be marked SPENT. The verifier MAY open a new session with the same or different challenges and retry from the beginning.

To avoid partial completion near the session expiry boundary, signing requests for all 5 challenges SHOULD be submitted within the first 25 minutes of the session window, allowing the final 5 minutes as a buffer for the last signing round to complete.

#### Scenario: Partial session expires as OPEN
- **WHEN** fewer than 5 signatures are assembled before the 30-minute session window closes
- **THEN** the session expires as OPEN; no partial signatures are recorded on-chain; the verifier must open a new session to retry

#### Scenario: New session required after partial expiry
- **WHEN** a session expires with some challenges signed but not all
- **THEN** the verifier opens a new session with a new nonce and `challenge_hashes`; there is no mechanism to resume a partially completed session

### Requirement: Verifier public key cache TTL
Verifier implementations SHALL cache an agent's resolved public key (after succession chain traversal) for at most 5 minutes. Verifiers SHALL subscribe to `SuccessionPublished` on-chain events and invalidate their cached public key immediately upon receiving such an event for the relevant agent. A verifier MUST NOT use a cached key that is older than 5 minutes without re-resolving the succession chain.

#### Scenario: Cached key is refreshed after TTL
- **WHEN** a verifier's cached public key for an agent is older than 5 minutes
- **THEN** the verifier re-walks the succession chain before using the key for signature verification

#### Scenario: SuccessionPublished event triggers immediate cache invalidation
- **WHEN** a verifier receives a `SuccessionPublished` on-chain event for an agent whose key it has cached
- **THEN** the cached key is invalidated immediately, regardless of remaining TTL
