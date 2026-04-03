## ADDED Requirements

### Requirement: Operator discovery and VRF sampling
Before initiating a signing request, the agent SHALL read the on-chain operator registry to obtain the full list of eligible operators (registered, stake above AVS minimum). The agent SHALL compute VRF-based operator sampling using the on-chain-derived seed `keccak256(session_id || blockhash(B - 1))` where B is the block in which `initSession` was confirmed. The agent selects the K operators corresponding to the lowest hash values of `keccak256(seed || operator_id)` for each registered operator. This computation is deterministic and independently verifiable by any party with on-chain data.

#### Scenario: Agent computes operator sample deterministically
- **WHEN** the agent initiates a signing request for a session confirmed in block B
- **THEN** it reads the operator registry, computes `seed = keccak256(session_id || blockhash(B - 1))`, ranks all eligible operators by `keccak256(seed || operator_id)`, and selects the K with the lowest values

#### Scenario: Operators verify their own selection
- **WHEN** an operator receives a signing request from the agent
- **THEN** it independently computes the VRF ranking from on-chain data and verifies it is in the selected K before proceeding; if it is not in the selected set, it rejects the request

#### Scenario: Under-staked operators are excluded from sampling
- **WHEN** the agent computes the VRF ranking
- **THEN** operators whose current staked balance is below the AVS minimum are excluded from the candidate pool before sampling

### Requirement: Round 1 — pre-check and nonce generation
Before generating any nonce material, an operator SHALL verify:
1. The session exists on-chain with `status: OPEN`
2. The auth token is valid: `ed25519.verify(auth_token, session_id || message_hash || token_nonce, control_pubkey)` where `control_pubkey` is read from the session record (snapshotted from AnchorIdentity at `initSession` time)
3. The `token_nonce` has not been seen in a prior request within this session
4. `keccak256(raw_challenge)` is in `session.challenge_hashes`
5. `sha256(raw_challenge || session_id) == message`
6. The operator's own staked balance meets the AVS minimum
7. The epoch in the signing request matches the operator's current active share epoch

If any check fails, the operator SHALL reject the request, emit a signed rejection receipt to the agent, and generate no nonce material.

If all checks pass, the operator SHALL derive nonces using the RFC 9591 hybrid scheme and send a signed nonce commitment directly to the agent.

Nonce derivation:
```
nonce_material = HKDF-SHA-512(
    IKM  = secret_share_bytes,
    salt = crypto.getRandomValues(new Uint8Array(32)),
    info = "FROST-ED25519-SHA512-v1" || session_id || message_hash
)
(d_i, e_i) = reduce_mod_q(nonce_material[0:32], nonce_material[32:64])
```

#### Scenario: All pre-checks pass — signed commitment sent to agent
- **WHEN** an operator validates all six pre-checks successfully
- **THEN** it generates `(d_i, e_i)` via the hybrid HKDF scheme and sends `{ D_i: d_i·G, E_i: e_i·G, epoch, signature: sign({ session_id, round_index, epoch, D_i, E_i, timestamp }, avs_key) }` directly to the agent

#### Scenario: Failed auth token — rejection receipt sent
- **WHEN** `ed25519.verify(auth_token, session_id || message_hash || token_nonce, control_pubkey)` returns false
- **THEN** the operator sends a signed rejection receipt to the agent with reason `"invalid-auth-token"` and generates no nonce material

#### Scenario: Replayed token nonce — rejection receipt sent
- **WHEN** the `token_nonce` was already seen in a prior request within this session
- **THEN** the operator sends a signed rejection receipt with reason `"replayed-token-nonce"` and generates no nonce material

#### Scenario: Challenge not committed — rejection receipt sent
- **WHEN** `keccak256(raw_challenge)` is not in `session.challenge_hashes`
- **THEN** the operator sends a signed rejection receipt with reason `"challenge-not-committed"` and generates no nonce material

#### Scenario: Epoch mismatch — rejection receipt sent
- **WHEN** the epoch in the signing request does not match the operator's current active share epoch
- **THEN** the operator sends a signed rejection receipt with reason `"epoch-mismatch"` and generates no nonce material

#### Scenario: Nonce scalars are zeroed after signing
- **WHEN** the partial signature is computed in Round 2
- **THEN** the nonce scalar bytes `d_i` and `e_i` are overwritten with zeros before any other operation

### Requirement: Round 1 — agent collects and aggregates nonce commitments
The agent SHALL collect signed nonce commitments from all K sampled operators. After receiving K valid signed commitments, the agent SHALL compute the aggregated nonce commitment per the FROST protocol and broadcast it back to all K operators to initiate Round 2.

#### Scenario: Agent waits for K valid commitments
- **WHEN** the agent has received fewer than K signed nonce commitments
- **THEN** it continues waiting; the timeout is 5 minutes from the signing request initiation

#### Scenario: Agent broadcasts aggregated nonce to start Round 2
- **WHEN** K valid signed nonce commitments are received
- **THEN** the agent computes the aggregated nonce commitment and sends it to all K operators simultaneously

#### Scenario: Operator with invalid signature is excluded
- **WHEN** a nonce commitment arrives with a signature that does not verify under the sender's registered AVS key
- **THEN** the agent discards the commitment; if fewer than K valid commitments arrive within the timeout, the round expires

### Requirement: Round 2 — partial signature computation and delivery
Upon receiving the aggregated nonce commitment from the agent, each of the K operators SHALL compute its partial signature using the FROST protocol and its key share, then send the partial signature directly to the agent. The partial signature SHALL be a scalar `z_i = d_i + e_i·ρ_i + λ_i·s_i·c` where the binding factor `ρ_i`, Lagrange coefficient `λ_i`, and challenge `c` are computed per RFC 9591.

#### Scenario: Partial signature is sent directly to agent
- **WHEN** an operator receives the Round 2 aggregated nonce commitment from the agent
- **THEN** it computes `z_i` per RFC 9591 and sends `{ operator_id, partial_sig: z_i }` directly to the agent

#### Scenario: Operator session re-verification before Round 2
- **WHEN** an operator receives the Round 2 message from the agent
- **THEN** it re-verifies that the session is still `status: OPEN` on-chain before computing the partial signature

#### Scenario: Epoch change between rounds causes explicit rejection
- **WHEN** an operator receives the Round 2 message and its current active share epoch no longer matches the epoch stamped in its Round 1 signed commitment for this session
- **THEN** the operator sends a signed rejection receipt with reason `"epoch-changed-between-rounds"` and does NOT compute a partial signature; the agent receives an explicit failure signal and may retry the signing request under the new epoch

### Requirement: Agent FROST aggregation
After collecting K partial signatures, the agent SHALL aggregate them into a single Ed25519 signature using the FROST aggregation algorithm: `z = Σ z_i mod q`. The agent SHALL verify the assembled signature against the group public key before accepting it: `ed25519.verify(sig, message, group_pubkey)`. If verification fails, the agent discards the assembled signature and may retry the entire signing request.

#### Scenario: Agent aggregates K partial signatures
- **WHEN** the agent has received K valid partial signatures
- **THEN** it computes `z = Σ z_i mod q` and forms the Ed25519 signature `(R, z)` where `R` is the aggregated nonce point

#### Scenario: Assembled signature is verified by agent before use
- **WHEN** the agent completes aggregation
- **THEN** it runs `ed25519.verify(sig, message, group_pubkey)` and only accepts the signature if verification passes

#### Scenario: Verification failure triggers retry
- **WHEN** the assembled signature fails Ed25519 verification
- **THEN** the agent discards the signature, logs the failure, and may initiate a new signing request with a fresh VRF sample

### Requirement: Liveness and retry
If fewer than K signed nonce commitments are received in Round 1 within 5 minutes, or fewer than K partial signatures are received in Round 2 within 5 minutes of the Round 2 broadcast, the signing request SHALL expire. The on-chain session remains OPEN and unspent. The agent MAY retry by initiating a new signing request with a fresh VRF sample.

#### Scenario: Round 1 timeout expires the request
- **WHEN** fewer than K valid signed nonce commitments arrive within 5 minutes of the signing request initiation
- **THEN** the signing request is abandoned; the agent may retry with a new VRF sample

#### Scenario: Round 2 timeout expires the request
- **WHEN** fewer than K partial signatures arrive within 5 minutes of the Round 2 broadcast
- **THEN** the signing request is abandoned; the agent may retry with a new VRF sample

#### Scenario: Retry samples a potentially different operator set
- **WHEN** the agent retries a signing request
- **THEN** a new VRF sampling is computed for the new request; the resulting K-operator set may differ from the previous one

### Requirement: Per-agent signing rate limit
To limit the damage window if the agent's control key is compromised, operators SHALL enforce a per-agent rate limit of 60 signing requests per hour per `agent_pubkey`. If this limit is exceeded, the operator SHALL reject the signing request with a rate-limit-exceeded error and emit a signed rejection receipt. The rate limit window is a rolling 60-minute window.

#### Scenario: Rate limit not exceeded — signing proceeds
- **WHEN** an agent has submitted fewer than 60 signing requests to an operator in the past 60 minutes
- **THEN** the operator processes the request normally

#### Scenario: Rate limit exceeded — operator rejects
- **WHEN** an operator has received 60 or more valid signing requests from the same `agent_pubkey` in the past 60 minutes
- **THEN** the operator rejects the request with a rate-limit-exceeded error, emits a signed rejection receipt, and generates no nonce material
