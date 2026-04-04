## 1. Threat Model — Close False Gaps and Update Status

- [ ] 1.1 Update T-003 entry: add note that the attack is infeasible under the current spec (public Feldman commitments + PoK uniquely determine valid share at each index); redirect residual risk to T-A5b
- [ ] 1.2 Update T-004 entry: remove standalone grinding framing; document that the attack collapses into T-001 (if nonce scalars are reused) or T-006 (if the operator logs its own nonces); remove as an independent threat
- [ ] 1.3 Update T-001 entry: clarify that the HKDF `info` binding to `session_id || message_hash` is the primary structural defense against nonce reuse; nonce scalar zeroing is defense-in-depth against post-computation memory exfiltration
- [ ] 1.4 Mark T-016, T-019, T-020, T-024, T-028 with resolution status referencing this change
- [ ] 1.5 Update Risk Matrix: demote T-003 and T-004 to "Closed — Infeasible"; add T-024 on-chain resharing as "Addressed"

## 2. on-chain-session/spec.md — Reentrancy, Slash Access, Solidity Version

- [ ] 2.1 Add requirement: `SessionRegistry` MUST target Solidity 0.8+ for checked arithmetic; no `unchecked` blocks in counter-tracking paths
- [ ] 2.2 Add requirement: `spendSession` SHALL apply state mutations in strict CEI order — (1) status and counter effects first, (2) events second, (3) external calls or ETH transfers last; `session.status = SPENT` SHALL be the first state write, before any signature verification loop completes
- [ ] 2.3 Add requirement: OpenZeppelin `ReentrancyGuard.nonReentrant` SHALL be applied to `initSession`, `spendSession`, `acknowledgeSession`, `slashNonAcknowledgment`, `slashSessionAbandonment`
- [ ] 2.4 Add requirement: bond refunds SHALL use pull-payment — verifiers and operators claim bond via a separate `withdrawBond()` call; no ETH transfer in the `spendSession` or slash function hot paths
- [ ] 2.5 Add requirement: slash functions SHALL require cryptographically verifiable on-chain evidence; slash amounts SHALL be compile-time constants (`uint256 private constant`); no governance-settable slash parameter
- [ ] 2.6 Add requirement: `slashSessionAbandonment` SHALL require `block.timestamp > session.createdAt + SESSION_EXPIRY + 60 seconds` (60-second buffer against validator timestamp manipulation near the expiry boundary)
- [ ] 2.7 Add requirement: session status SHALL use a three-value enum `{ OPEN, SPENT, EXPIRED }`; `OPEN → EXPIRED` transitions are lazy (checked at `initSession` time); counter decrements exactly once per transition
- [ ] 2.8 Add requirement: session expiry with `status: OPEN` SHALL NOT trigger any bond reduction; expiry is a normal operational outcome, not a slashable condition
- [ ] 2.9 Add Foundry invariant test requirement: `invariant_sessionCountBounded` asserting `openSessionCounts[v] <= MAX_OPEN_SESSIONS` and `>= 0` for all verifiers after any sequence of operations
- [ ] 2.10 Unit tests:
  - `spendSession` marks SPENT before any external call (CEI ordering)
  - Reentrant `spendSession` via malicious verifier fallback reverts
  - Bond refund not transferred in `spendSession` hot path
  - Slash with timestamp at `SESSION_EXPIRY + 59s` reverts (buffer not elapsed)
  - Slash with timestamp at `SESSION_EXPIRY + 61s` succeeds
  - Session expiry alone does not reduce bond balance

## 3. frost-dkg/spec.md — Close T-003 and Clarify T-001/T-004

- [ ] 3.1 Add note to public key derivation requirement: the combination of public Feldman VSS commitments (all K coefficient commitments broadcast in Round 1) and mandatory proof-of-knowledge makes share forgery infeasible — the public commitment polynomial uniquely determines the valid evaluation at each recipient index; an operator cannot produce a different share that passes the VSS check without breaking discrete log; residual bad-share risk is addressed by T-A5b and the FROST-SHARE-ECIES-v1 dispute mechanism
- [ ] 3.2 Add note to Round 2 share distribution requirement: the primary defense against a malicious operator sending invalid shares is (a) Feldman VSS check on receipt and (b) the `slashBadShare` path from the FROST-SHARE-ECIES-v1 change; T-003-style "inconsistent polynomial" share forgery is not a distinct attack category under this spec

## 4. threshold-signing/spec.md — Clarify T-001/T-004 Nonce Defense Hierarchy

- [ ] 4.1 Add note to Round 1 nonce generation requirement: the HKDF binding to `session_id || message_hash` in the `info` field is the primary structural defense against nonce reuse — identical `(d_i, e_i)` across distinct messages is structurally impossible even if the CSPRNG produces an identical salt; nonce scalar zeroing after use (already required) is defense-in-depth against post-computation memory exfiltration
- [ ] 4.2 Confirm in the same note that `session_id` is always a `bytes32` (exactly 32 bytes, as derived by `keccak256(...)` in `initSession`), making the `info` field unambiguously parseable without a length delimiter

## 5. key-succession/spec.md — On-Chain Resharing Confirmations

- [ ] 5.1 Update Phase 1 of the resharing two-phase protocol: upon receiving their Phase 1 share, each operator SHALL validate the share against the ceremony's Feldman VSS commitments before acknowledging; the operator SHALL call `ackShareReceived(epoch, sig)` on the AVS contract, where `sig` covers `{ operator_id, epoch, action: "share_received_and_validated", vss_check: "pass" }` under their AVS key; an operator that receives an invalid share (VSS fails) SHALL broadcast a ceremony complaint instead of calling `ackShareReceived`
- [ ] 5.2 Update Phase 2: each operator SHALL call `confirmResharing(epoch, sig)` directly on the AVS contract within 30 minutes of Phase 1 completion; the contract counts confirmations; when all N are received the contract emits `ResharingCompleted(epoch, block.timestamp, operator_set_hash)`
- [ ] 5.3 Add abort path: after 30 minutes with fewer than N confirmations on-chain, any party MAY call `abortResharing(epoch)`; the contract emits `ResharingAborted(epoch)`; operators retain old shares and discard new ones
- [ ] 5.4 Update coordinator responsibility description: the coordinator initiates Phase 1 (sends encrypted shares to operators), then watches for `ResharingCompleted` or `ResharingAborted` events; the coordinator does NOT aggregate Phase 2 confirmations in memory; no persistent coordinator state is required for Phase 2
- [ ] 5.5 Update deletion attestation anchor: the 24-hour window for deletion attestations begins at the `ResharingCompleted` event block timestamp, not from a coordinator-local timer; the on-chain event is the authoritative anchor
- [ ] 5.6 Update `slashNonConfirmation` requirement: the `signed_share_receipt` is the on-chain `ackShareReceived` submission (i.e., the operator's on-chain Phase 1 acknowledgment); the contract verifies the receipt against the on-chain record and confirms no Phase 2 `confirmResharing` call exists for that operator and epoch
- [ ] 5.7 Unit tests:
  - `ackShareReceived` from an operator not in the ceremony set reverts
  - `confirmResharing` before `ackShareReceived` is on-chain reverts
  - `ResharingCompleted` is emitted exactly when the N-th `confirmResharing` arrives
  - `abortResharing` before 30 minutes reverts
  - `abortResharing` after 30 minutes with count < N succeeds
  - `slashNonConfirmation` with on-chain `ackShareReceived` and no `confirmResharing` after 30 minutes slashes
  - `slashNonConfirmation` for operator that confirmed on time reverts

## 6. verification-protocol/spec.md — SuccessionPublished Event

- [ ] 6.1 Add event definition to the SuccessionPublished requirement:
  ```solidity
  event SuccessionPublished(
      bytes32 indexed agentPubkey,
      bytes32 newPubkey,
      uint256 timestamp,
      uint256 blockNumber
  );
  ```
  The `indexed agentPubkey` field enables per-agent log filtering at the RPC node; without it, verifiers must parse all succession events globally
- [ ] 6.2 Add re-org handling rule: verifiers SHALL wait until a `SuccessionPublished` event is at least 6 blocks deep (`currentBlock - event.blockNumber >= 6`) before treating it as final; during the finality window, the verifier continues using the cached (old) key, which remains valid until succession is finalized
- [ ] 6.3 Clarify cache invalidation priority: the 5-minute TTL is the hard backstop guarantee; WebSocket subscription is a SHOULD optimization; poll-based fallback (`eth_getLogs` every 60 seconds) is a SHOULD for resilience under WebSocket outage
- [ ] 6.4 Add subscription filter spec: `{ address: SuccessionRegistry, topics: [keccak256("SuccessionPublished(bytes32,bytes32,uint256,uint256)"), agentPubkeyPadded] }` where `agentPubkeyPadded` is the 32-byte left-padded pubkey
- [ ] 6.5 Unit tests:
  - `SuccessionPublished` is emitted by `revealSuccession` with correct field values
  - Verifier does not invalidate cache on event at depth < 6 blocks
  - Verifier invalidates cache on event at depth >= 6 blocks
  - Verifier re-walks chain after TTL expiry regardless of event delivery
