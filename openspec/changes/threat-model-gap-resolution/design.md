# Design: Threat Model Gap Resolution

## T-003 / T-004 — Close False Gaps

### T-003: Feldman VSS Share Forgery (infeasible)

The threat model claims a malicious operator can send "different polynomial shares" to different recipients while passing each recipient's individual VSS check. This is cryptographically impossible under the current spec.

When operator `j` publishes commitments `C_j = [a_{j0}·G, a_{j1}·G, ..., a_{j(K-1)}·G]` in Round 1, the polynomial `f_j(x) = Σ a_{jk}·x^k` is fully determined at every evaluation point modulo `q`. The VSS check `s·G == Σ_k(C_j[k]·i^k)` has exactly one solution in `Z_q` — the honest polynomial evaluation `f_j(i)`. An operator cannot produce a different scalar `s' ≠ f_j(i)` that satisfies the same linear combination of group elements without breaking discrete log on Ed25519.

The only coherent attack (embedding a backdoor via a structured polynomial) collapses into the rogue key attack (T-002), which is blocked by the mandatory PoK requirement. The "inconsistency not directly detectable" language in the threat model applies only to a protocol without public Feldman commitments — not this one.

**Residual risk:** the authenticated-bad-share attack (T-A5b) is separately addressed by the FROST-SHARE-ECIES-v1 change.

### T-004: Partial Signature Grinding (not a standalone attack)

Without access to the nonce scalars `(d_i, e_i)`, each partial signature `z_i = d_i + e_i·ρ_i + λ_i·s_i·c` is one equation in two unknowns. No number of observed partial signatures yields the share. The grinding framing implies a probabilistic attack structure that does not exist for uniform random nonces over `Z_q`.

The attack only becomes viable if an operator records its own nonce scalars — which is an operator infrastructure compromise (T-006), not a distinct grinding scenario.

---

## T-001 / T-004 — HKDF Binding Clarification

The threshold-signing spec already mandates the RFC 9591 hybrid HKDF nonce derivation:

```
nonce_material = HKDF-SHA-512(
    IKM  = secret_share_bytes,
    salt = crypto.getRandomValues(new Uint8Array(32)),
    info = "FROST-ED25519-SHA512-v1" || session_id || message_hash
)
```

The `info` field binds the nonce material to the specific `(session_id, message_hash)` pair. Even if the random `salt` repeats identically across two signing sessions with distinct messages, the HKDF output — and therefore `(d_i, e_i)` — will differ. Identical `(d_i, e_i)` across distinct messages is structurally impossible.

**Nonce scalar zeroing** — already required by the spec — is defense-in-depth against post-computation memory exfiltration (T-004). It is not the primary control against nonce reuse. The threat model text that describes deletion as the T-001 mitigation is backwards and must be corrected.

One precision note: the `info` field uses `session_id || message_hash` as a byte concatenation. If `session_id` is a fixed-length `bytes32`, this is canonically unambiguous. The spec should confirm `session_id` is always exactly 32 bytes (as derived by `keccak256(...)` in `initSession`) to prevent any future variable-length canonicalization concern.

---

## T-016 — SessionRegistry Reentrancy Protection

Three concrete requirements address the reentrancy surface:

**1. Checks-effects-interactions ordering**

`spendSession` SHALL apply state mutations before any external call or token transfer. The ordering is:
1. Check: `require(session.status == OPEN)`, `require(msg.sender == session.verifierAddress)`, verify all 5 signatures
2. Effect: `session.status = SPENT`, decrement `openSessionCount[msg.sender]`
3. Interaction: emit event, then any bond refund or external call

**2. ReentrancyGuard on all state-mutating session functions**

Apply OpenZeppelin `ReentrancyGuard.nonReentrant` to: `initSession`, `spendSession`, `acknowledgeSession`, `slashNonAcknowledgment`, `slashSessionAbandonment`.

Note: `nonReentrant` does not block cross-contract reentrancy. Any EigenLayer slash callback that re-enters `SessionRegistry` via a separate contract path is not blocked by the modifier. The CEI ordering is the load-bearing protection; `nonReentrant` catches the direct case.

**3. Pull-payment pattern for bond refunds**

Bond refunds SHALL use a pull-payment pattern: operators or verifiers call a separate `withdrawBond()` function to claim their balance. `spendSession` and slash functions SHALL NOT transfer ETH directly. This eliminates the reentrancy surface from the hot path entirely.

---

## T-019 — Slash Access Control and Evidence Format

**Restrict caller access:**

Slash functions (`slashNonAcknowledgment`, `slashSessionAbandonment`, `slashNonConfirmation`, `slashMissingDeletion`, `slashBadShare`, `slashNonceReuse`) SHALL require cryptographically verifiable on-chain evidence supplied by the caller. The contract verifies the evidence independently — no external oracle, no reputation system, no governance parameter. Any address may call these functions provided they supply valid evidence; no whitelist of callers is maintained. The contract's evidence verification is the access control.

**Hardcode slash amounts:**

Slash amounts SHALL be compile-time constants defined in the contract bytecode. No governance parameter or storage variable SHALL control the slash fraction. Example: `uint256 private constant ABANDONMENT_SLASH = 0.1 ether`. Governance can only change slash amounts by deploying a new contract version, never by calling a setter.

**SLASH_BUFFER for timestamp-griefing prevention:**

`slashSessionAbandonment` SHALL require `block.timestamp > session.createdAt + SESSION_EXPIRY + SLASH_BUFFER` where `SLASH_BUFFER = 60 seconds`. This 60-second margin prevents validator timestamp manipulation near expiry boundaries from mis-classifying sessions.

**Expiry is not slashable:**

Session expiry with `status: OPEN` SHALL NOT trigger any bond reduction. Bond reductions occur only on explicit misbehavior proofs (abandonment threshold, non-acknowledgment, nonce reuse). A session timing out is a normal operational outcome.

---

## T-020 — Solidity 0.8+ and Invariant Tests

**Solidity version:** All `SessionRegistry`, `AnchorIdentity`, and `SuccessionRegistry` contracts SHALL target Solidity 0.8+. Checked arithmetic is the default; no `unchecked` blocks shall be used in counter-tracking paths.

**State machine:** Session status SHALL use a three-value enum `{ OPEN, SPENT, EXPIRED }`. The `EXPIRED` state prevents double-decrement: a session transitions `OPEN → EXPIRED` lazily (when a new `initSession` is called and expired sessions are swept), and the counter decrements exactly once per transition.

**Invariant tests (Foundry):**
```solidity
function invariant_sessionCountBounded() public view {
    for (uint i = 0; i < allVerifiers.length; i++) {
        assertLe(openSessionCounts[allVerifiers[i]], MAX_OPEN_SESSIONS);
        assertGe(openSessionCounts[allVerifiers[i]], 0);
    }
}
```

---

## T-024 — Resharing Confirmations On-Chain

### Problem

The current spec routes Phase 2 confirmations to the coordinator (agent machine). The agent holds no persistent state and can restart. A restart during Phase 2 loses all in-progress confirmation aggregation; the 30-minute window has been running but no confirmations are recorded anywhere durable.

### Solution

Phase 2 confirmations go directly to the AVS contract. The coordinator becomes a watcher.

**Phase 1 — distribute and acknowledge on-chain:**

Upon receiving their Phase 1 share, each operator:
1. Validates the share against the resharing ceremony's Feldman VSS commitments
2. Calls `ackShareReceived(epoch, sig)` on-chain where `sig` covers `{ operator_id, epoch, action: "share_received_and_validated", vss_check: "pass" }` under the operator's AVS key

The contract stores this receipt. It becomes the anchor for `slashNonConfirmation` evidence. An operator that receives an invalid share (fails VSS) SHALL broadcast a ceremony complaint rather than call `ackShareReceived`. The receipt therefore attests VSS validity, not merely delivery.

**Phase 2 — confirm on-chain:**

Each operator calls `confirmResharing(epoch, sig)` on the AVS contract within 30 minutes of Phase 1 completion. The contract counts confirmations. When all N are received: `emit ResharingCompleted(epoch, block.timestamp, operator_set_hash)`. The coordinator watches for this event.

**Abort path:**

After 30 minutes with count < N, any party calls `abortResharing(epoch)`. The contract emits `ResharingAborted(epoch)`. Operators retain old shares. New shares are discarded.

**Deletion attestation anchor:**

`ResharingCompleted` is emitted by the contract — it is the authoritative timestamp for the 24-hour deletion attestation window. No coordinator memory or signed coordinator message is required.

```
Phase 1:
  Coordinator → each operator: encrypted share
  Operator validates VSS → on-chain: ackShareReceived(epoch, sig)

Phase 2 (30-minute window):
  Operator → on-chain: confirmResharing(epoch, sig)
  Contract: count++ → when count == N: emit ResharingCompleted(epoch)

Abort:
  After 30 min, count < N: anyone calls abortResharing(epoch)
  → emit ResharingAborted(epoch)
  → operators retain old shares
```

**Gas cost:** 2N on-chain transactions per resharing ceremony (N acks + N confirmations). For N=12 at current gas prices (~25,000 gas per call), this is approximately 600,000 gas total — about $3–8 USD per resharing at typical gas prices. Resharing ceremonies are infrequent (epoch-based or on detected compromise); this cost is acceptable.

**Coordinator responsibility after this change:** The coordinator initiates Phase 1 (sends encrypted shares), monitors for `ResharingCompleted` or `ResharingAborted` events, and signals operators to delete old shares upon `ResharingCompleted`. No in-memory aggregation required.

---

## T-028 — SuccessionPublished Event Design

### Event Definition

```solidity
event SuccessionPublished(
    bytes32 indexed agentPubkey,   // indexed: enables efficient per-agent log filtering
    bytes32 newPubkey,             // verifier can update cache immediately on event receipt
    uint256 timestamp,             // for TTL comparison
    uint256 blockNumber            // for re-org detection
);
```

The `indexed agentPubkey` field is load-bearing. Without it, verifiers must parse all succession events globally and filter in-process. With it, the RPC node does the filter: verifiers subscribe with `{ topics: [eventSig, paddedAgentPubkey] }`.

### Verifier Cache Invalidation Rules

**Re-org handling:** Verifiers SHALL wait until a `SuccessionPublished` event is at least 6 blocks deep (i.e., `currentBlock - event.blockNumber >= 6`) before treating it as final and invalidating their cache. During the uncertainty window (< 6 blocks), the verifier continues using the old cached key. The old key remains cryptographically valid until the succession is finalized; using it during the finality window is safe.

**Primary guarantee (TTL):** The 5-minute TTL in the verification-protocol spec is the hard backstop. Every verifier implementation must enforce it regardless of event delivery status.

**Optimization (WebSocket subscription):** Verifier implementations SHOULD subscribe to `SuccessionPublished` via WebSocket for low-latency cache invalidation. This is a SHOULD, not a MUST — WebSocket connections are not reliably persistent over long periods.

**Fallback (polling):** Verifier implementations SHOULD poll `eth_getLogs` for `SuccessionPublished` events scoped to their cached agent set at least every 60 seconds. Combined with the 5-minute TTL, this guarantees staleness of at most 6 minutes under WebSocket outage.

**Subscription filter:**
```
{
  address: SuccessionRegistry,
  topics: [
    keccak256("SuccessionPublished(bytes32,bytes32,uint256,uint256)"),
    agentPubkeyPadded   // 32-byte left-padded pubkey for indexed match
  ]
}
```
