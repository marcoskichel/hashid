## ADDED Requirements

### Requirement: Signing request initiation
The agent SHALL submit a signing request by sending the message to be signed and a valid on-chain session ID to the AVS coordinator endpoint. The coordinator SHALL select K operators via VRF sampling and forward the request.

#### Scenario: Signing request is submitted
- **WHEN** the agent calls the signing endpoint with `{ message, session_id }`
- **THEN** the coordinator verifies the session exists on-chain, selects K operators via VRF, and forwards the request to those K operators

#### Scenario: Invalid session is rejected
- **WHEN** the agent submits a session ID that does not exist on-chain or is already spent
- **THEN** the coordinator rejects the request with a session-not-found or session-spent error before contacting any operator

### Requirement: Round 1 pre-check — challenge commitment verification
Before generating any nonce material, an operator SHALL verify that the signing request's challenge is committed in the on-chain session record. This check MUST precede nonce generation so that no nonce material is produced for an uncommitted challenge.

The operator verifies both conditions:
1. `keccak256(raw_challenge) ∈ session.challenge_hashes` (challenge is in the committed set)
2. `sha256(raw_challenge || session_id) == message` (coordinator formed the message correctly)

If either check fails, the operator SHALL reject the request and emit a signed rejection receipt `{ session_id, message_hash, challenge_hash, round: "1", timestamp }` to the coordinator log.

#### Scenario: Challenge is committed — operator proceeds
- **WHEN** `keccak256(raw_challenge)` is present in `session.challenge_hashes` and the message is correctly formed
- **THEN** the operator proceeds to nonce generation

#### Scenario: Challenge not in committed set — operator rejects
- **WHEN** `keccak256(raw_challenge)` is not present in `session.challenge_hashes`
- **THEN** the operator rejects the request, emits a rejection receipt, and generates no nonce material

#### Scenario: Malformed message — operator rejects
- **WHEN** `sha256(raw_challenge || session_id) ≠ message`
- **THEN** the operator rejects the request and generates no nonce material

### Requirement: Per-request nonce generation
Each participating operator SHALL derive nonces using the RFC 9591 hybrid scheme. Nonces SHALL NOT be reused across requests. The nonce scalars SHALL be zeroed from memory immediately after the partial signature is computed.

Nonce derivation:
```
nonce_material = HKDF-SHA-512(
    IKM  = secret_share_bytes,
    salt = crypto.getRandomValues(new Uint8Array(32)),  // fresh per request
    info = "FROST-ED25519-SHA512-v1" || session_id || message_hash
)
(d_i, e_i) = reduce_mod_q(nonce_material[0:32], nonce_material[32:64])
```

The `session_id` in the `info` field ensures that VM snapshot/restore scenarios produce detectable (identical commitment, different session) reuse rather than silent reuse.

#### Scenario: Nonces are derived per request
- **WHEN** an operator proceeds to Round 1 after the pre-check passes
- **THEN** it derives `(d_i, e_i)` using the hybrid HKDF scheme with a fresh random salt

#### Scenario: Nonce scalars are zeroed after signing
- **WHEN** the partial signature `z_i` is computed
- **THEN** the nonce scalar bytes `d_i` and `e_i` are overwritten with zeros before any other operation

#### Scenario: Nonce reuse is detectable and slashable
- **WHEN** an operator's nonce commitments `(D_i, E_i)` appear identically in the coordinator's log for two different sessions
- **THEN** a `slashNonceReuse` proof can be submitted on-chain to slash the operator

### Requirement: Operator stake verification at signing time
Before generating nonce material for any signing request, an operator SHALL verify (via on-chain read) that its current staked balance meets the AVS minimum stake threshold. If the operator's stake has fallen below the minimum since DKG participation, the operator SHALL reject the signing request with a stake-below-minimum error and SHALL NOT produce nonce material or a partial signature. The coordinator SHALL exclude operators below the minimum stake threshold from VRF sampling before routing signing requests.

#### Scenario: Operator with sufficient stake proceeds normally
- **WHEN** an operator's current staked balance meets or exceeds the AVS minimum
- **THEN** it proceeds with signing request processing normally

#### Scenario: Under-staked operator rejects signing request
- **WHEN** an operator's current staked balance has fallen below the AVS minimum
- **THEN** it rejects the signing request with a stake-below-minimum error and generates no nonce material

#### Scenario: Coordinator excludes under-staked operators from VRF sampling
- **WHEN** the coordinator performs VRF operator sampling for a session
- **THEN** operators below the minimum stake threshold are excluded from the candidate pool before sampling occurs

### Requirement: Agent authorization token verification
Every signing request SHALL include an agent authorization token `auth_token = sign(session_id || message_hash, control_privkey)`. Before generating any nonce material, an operator SHALL verify the token: `ed25519.verify(auth_token, session_id || message_hash, control_pubkey)` where `control_pubkey` is read from the on-chain `AnchorIdentity` record for the agent. If the token is absent or fails verification, the operator SHALL reject the request without generating nonce material and SHALL emit a signed rejection receipt.

#### Scenario: Valid auth token allows signing to proceed
- **WHEN** an operator receives a signing request with a valid auth token
- **THEN** it proceeds to the Round 1 pre-check (challenge commitment verification)

#### Scenario: Missing auth token is rejected
- **WHEN** an operator receives a signing request with no auth token
- **THEN** the operator rejects the request, emits a rejection receipt, and generates no nonce material

#### Scenario: Invalid auth token is rejected
- **WHEN** `ed25519.verify(auth_token, session_id || message_hash, control_pubkey)` returns false
- **THEN** the operator rejects the request, emits a rejection receipt, and generates no nonce material

### Requirement: Partial signature computation
Each of the K sampled operators SHALL compute a partial signature over the message using its key share and the session nonces, then return the partial signature to the coordinator.

#### Scenario: Partial signature is returned
- **WHEN** an operator receives a valid signing request with a known session ID
- **THEN** it computes a partial signature and returns `{ operator_id, partial_sig }` to the coordinator

#### Scenario: Operator policy check
- **WHEN** an operator receives a signing request
- **THEN** it verifies the session exists on-chain and the requesting agent pubkey matches the session registration before signing

### Requirement: Signature aggregation
The coordinator SHALL aggregate K or more partial signatures into a single valid Ed25519 signature using the FROST aggregation algorithm.

#### Scenario: Aggregation succeeds with exactly K partial signatures
- **WHEN** exactly K valid partial signatures are received
- **THEN** the coordinator combines them into a single Ed25519 signature that verifies against the group public key

#### Scenario: Partial signature from non-sampled operator is rejected
- **WHEN** a partial signature arrives from an operator not in the VRF-sampled set for this session
- **THEN** the coordinator discards it and does not include it in aggregation

### Requirement: Liveness and retry
If fewer than K partial signatures are received within 5 minutes, the signing request SHALL expire. The agent SHALL be able to retry with a new signing request, which will sample a fresh set of K operators.

#### Scenario: Request expires after timeout
- **WHEN** fewer than K partial signatures are received within 5 minutes
- **THEN** the signing request is marked expired; the on-chain session remains unspent; the agent may retry

#### Scenario: Retry samples different operators
- **WHEN** the agent retries a signing request after expiry
- **THEN** a new VRF sampling is performed; the new K-operator set may differ from the previous one

### Requirement: Final signature delivery
The coordinator SHALL return the assembled Ed25519 signature to the agent. The agent SHALL verify the signature against the group public key before accepting it.

#### Scenario: Signature is verified by agent
- **WHEN** the coordinator returns a signature
- **THEN** the agent verifies `ed25519.verify(signature, message, group_pubkey)` before using the signature

#### Scenario: Invalid assembled signature is rejected
- **WHEN** the assembled signature fails Ed25519 verification
- **THEN** the agent discards it and may retry
