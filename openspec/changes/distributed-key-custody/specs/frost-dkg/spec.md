## ADDED Requirements

### Requirement: DKG initiation
The CLI SHALL initiate a FROST DKG ceremony by broadcasting a `DKGInit` message to all registered EigenLayer AVS operators, specifying the threshold parameters `(K, N)` and a session identifier. Before broadcasting, the agent SHALL read the on-chain operator registry to obtain each operator's endpoint URL and AVS public key; the agent contacts operators directly at their registered endpoints without routing through any coordinator.

#### Scenario: DKG session is created
- **WHEN** `hashid bootstrap` is invoked
- **THEN** a `DKGInit` message with `{ session_id, threshold: K, total: N }` is sent directly to each of the N operators at their registered endpoint URLs obtained from the on-chain operator registry

#### Scenario: Insufficient operators available
- **WHEN** fewer than N operators acknowledge `DKGInit` within the timeout
- **THEN** bootstrap fails with an error listing unresponsive operators before any key material is generated

### Requirement: Round 1 — commitment and proof-of-knowledge broadcast
Each operator SHALL generate a secret polynomial, compute Feldman VSS commitments, compute a Schnorr proof-of-knowledge (PoK) over the constant-term commitment, and broadcast both together. The PoK is mandatory and MUST be included in every Round 1 broadcast.

The PoK `σ_i = (R_i, μ_i)` is computed as follows:
- Sample nonce `k ← Z_q` from a CSPRNG
- Compute `R_i = k · G`
- Compute challenge `c_i = HDKG(i || φ_{i0} || R_i)` where `HDKG(x) = SHA-512("FROST-ED25519-SHA512-v1" || "dkg" || x) mod q`
- Compute response `μ_i = k + a_{i0} · c_i mod q`

where `φ_{i0} = a_{i0} · G` is the constant-term commitment and `a_{i0}` is the secret constant term of operator i's polynomial.

#### Scenario: Commitments and PoK are broadcast together
- **WHEN** an operator receives `DKGInit`
- **THEN** it generates a degree-(K-1) polynomial, computes Feldman VSS commitments `C_i`, computes `σ_i = (R_i, μ_i)`, and broadcasts `(C_i, σ_i)` to all other operators

#### Scenario: Invalid VSS commitment is rejected
- **WHEN** an operator receives a share in Round 2 that does not verify against the sender's Round 1 commitment
- **THEN** the operator broadcasts a complaint for that peer and the ceremony aborts if the complaint is confirmed

### Requirement: Round 1 — proof-of-knowledge verification before Round 2
Each operator SHALL verify the PoK `σ_ℓ = (R_ℓ, μ_ℓ)` from every other operator ℓ before computing or sending any Round 2 share material. Verification checks: `R_ℓ == μ_ℓ · G - c_ℓ · φ_{ℓ0}` where `c_ℓ = HDKG(ℓ || φ_{ℓ0} || R_ℓ)`. If any proof fails, the operator SHALL abort the ceremony and broadcast a complaint identifying the culprit operator. No Round 2 shares SHALL be sent until all N-1 proofs pass.

#### Scenario: All proofs valid — Round 2 proceeds
- **WHEN** an operator receives valid `(C_ℓ, σ_ℓ)` from all N-1 peers and all PoK proofs verify
- **THEN** the operator proceeds to Round 2 share computation

#### Scenario: Invalid proof-of-knowledge aborts ceremony before Round 2
- **WHEN** an operator receives a Round 1 package from peer ℓ where `R_ℓ ≠ μ_ℓ · G - c_ℓ · φ_{ℓ0}`
- **THEN** the operator aborts the ceremony, broadcasts a complaint identifying ℓ as the culprit, and does NOT send any Round 2 shares to any operator

### Requirement: Round 2 — share distribution
Each operator SHALL compute a secret share for every other operator, encrypt it to the recipient's public key, and send it point-to-point.

#### Scenario: Shares are distributed
- **WHEN** Round 1 commitments are collected from all N operators
- **THEN** each operator sends an encrypted share to each of the other N-1 operators

#### Scenario: Share fails VSS check
- **WHEN** an operator receives a share that does not verify against the sender's Round 1 commitment
- **THEN** the operator broadcasts a complaint; the ceremony aborts

### Requirement: Public key derivation
After Round 2, the group public key SHALL be derived by summing all operators' commitment constant terms. The derived public key SHALL be a standard Ed25519 public key.

#### Scenario: Public key is derived consistently
- **WHEN** all N operators complete Round 2 without complaints
- **THEN** every operator independently derives the same group public key

#### Scenario: Derived public key is valid Ed25519
- **WHEN** the group public key is derived
- **THEN** it is a 32-byte compressed Edwards25519 point that passes standard Ed25519 key validation

### Requirement: Share storage
Each operator SHALL store its key share in secure, persistent storage, protected by the operator's own access controls. The share SHALL NOT be transmitted to any party after DKG completion.

#### Scenario: Share is retained only by its operator
- **WHEN** DKG completes
- **THEN** each operator holds exactly one share; no operator holds another's share; the CLI holds no shares

#### Scenario: Share is not transmitted post-DKG
- **WHEN** DKG is complete and a signing request has not been initiated
- **THEN** no share leaves the operator's secure storage

### Requirement: Epoch-based share resharing
The system SHALL support FROST resharing (ProactiveSS) to rotate shares across operators without changing the group public key. Resharing SHALL produce a new set of N shares. Old shares SHALL be cryptographically invalidated ONLY after all N operators have submitted Phase 2 confirmations as defined in the two-phase resharing protocol in `key-succession/spec.md`. Old shares remain valid throughout Phase 1 distribution; no operator SHALL delete its old share until all N Phase 2 confirmations are received and the ceremony is complete. The agent drives resharing in the same way it drives initial DKG — contacting operators directly at their registered endpoints with no separate coordinator.

#### Scenario: Resharing produces same public key
- **WHEN** FROST resharing completes
- **THEN** the group public key is identical before and after resharing

#### Scenario: Old shares are invalid after resharing
- **WHEN** FROST resharing completes (all N Phase 2 confirmations are received and the ceremony is complete)
- **THEN** a partial signature produced with an old share is rejected during aggregation

### Requirement: Resharing authorization — K-of-N endorsement of new operator set
Before a resharing ceremony may begin, the proposed new operator set MUST be endorsed by the current K-of-N operators via a FROST threshold signature. The endorsement payload is `sha256(agent_id || keccak256(sorted new_operator_addresses) || new_K || new_N || timestamp)`. The agent collects endorsement partial signatures from the current K-of-N operators and submits the assembled threshold signature on-chain via `authorizeResharing(agent_id, new_operator_set, new_K, new_N, timestamp, threshold_signature)`. The AVS contract verifies the threshold signature against the agent's current registered `group_pubkey` and records the authorization. `DKGInit` for resharing SHALL revert if no valid on-chain resharing authorization exists for the proposed operator set.

This requirement closes T-039: a compromised agent machine can propose an attacker-controlled operator set, but cannot compel the current independent staked operators to endorse it. The threshold signature is the proof that the current legitimate operator set approved the transition.

#### Scenario: Resharing proceeds only with on-chain authorization
- **WHEN** `DKGInit` is called for a resharing ceremony
- **THEN** the AVS contract verifies a valid `authorizeResharing` record exists for the exact `(agent_id, new_operator_set, new_K, new_N)` tuple before accepting the call; if no authorization exists the call reverts

#### Scenario: Current operators refuse a malicious proposed set
- **WHEN** an agent (possibly compromised) requests endorsement partial signatures for a new operator set controlled by an attacker
- **THEN** independent staked operators decline to contribute partial signatures; the agent cannot assemble a valid threshold endorsement; `authorizeResharing` cannot be submitted and resharing cannot begin

#### Scenario: Authorization is single-use
- **WHEN** `authorizeResharing` is consumed by a `DKGInit` call
- **THEN** the authorization record is marked used and cannot be replayed for a second resharing ceremony; a new authorization must be obtained for any subsequent resharing

#### Scenario: Expired authorization is rejected
- **WHEN** `authorizeResharing` is submitted with a `timestamp` more than 1 hour old
- **THEN** the contract reverts with an authorization-expired error; the agent must obtain a fresh endorsement

### Requirement: Operator concentration limit at DKG initiation
Before a DKG ceremony begins, the AVS contract SHALL verify that no single Ethereum address controls more than `floor((K-1)/N)` of the total operator seats, where K is the signing threshold and N is the total operator count. `DKGInit` SHALL revert if any address exceeds this limit. An address "controls" an operator seat if it is the operator's registered withdrawal address, signing key, or a known delegation relationship recorded in the AVS contract.

#### Scenario: Concentration check passes — DKG proceeds
- **WHEN** no single address controls more than `floor((K-1)/N)` operator seats
- **THEN** `DKGInit` is accepted and the ceremony begins

#### Scenario: Concentration check fails — DKGInit reverts
- **WHEN** any single address controls more than `floor((K-1)/N)` operator seats
- **THEN** `DKGInit` reverts with an operator-concentration-exceeded error before any key material is generated

#### Scenario: Concentration limit scales with threshold parameters
- **WHEN** K and N change (e.g., during resharing with a different operator set)
- **THEN** the concentration limit `floor((K-1)/N)` is recomputed for the new parameters
