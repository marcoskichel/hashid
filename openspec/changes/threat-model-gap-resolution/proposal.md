# Proposal: Threat Model Gap Resolution

## Problem

A structured review of `docs/threat-model.md` identified eight open gaps across five system capabilities. Three of the gaps (T-003, T-004, and the secondary framing of T-001) turned out to be mischaracterizations — the attacks are infeasible under the current design, but the threat model text says otherwise, which will mislead auditors. Five gaps represent real, unaddressed risks:

- **T-016**: `SessionRegistry.spendSession` has no reentrancy protection and no ordering guarantee between state mutation and external calls. Bond refund paths are the vector.
- **T-019**: Slash functions have no caller restriction in the spec. Nothing prevents an external address from supplying fabricated evidence or triggering slashing on normal session expiry.
- **T-020**: Session counter arithmetic is unguarded. Solidity 0.8+ protects against silent overflow but the spec does not require it.
- **T-024**: Resharing Phase 2 confirmations are routed through the coordinator (agent machine), which holds no persistent state. An agent restart during Phase 2 loses all in-progress confirmation aggregation, turning the 30-minute window into a partial-state loss scenario with no recovery path.
- **T-028**: The `SuccessionPublished` event is referenced in the verification-protocol spec but its structure is undefined. Verifiers cannot subscribe efficiently without an indexed field, and no re-org handling rule exists.

## What Changes

**Closes as false gaps:**
- T-003 (Feldman VSS share forgery) — infeasible given public coefficient commitments + PoK; threat model text corrected
- T-004 (partial signature grinding) — collapses into T-001 or T-006; removed as standalone attack framing

**Minor spec additions (prose only, no protocol structure changes):**
- T-001 / T-004: Clarify that the HKDF `info` binding to `session_id || message_hash` is the primary nonce-reuse defense; nonce scalar zeroing is defense-in-depth
- T-016: Add CEI ordering requirement and `nonReentrant` guard mandate to `SessionRegistry` state-mutating functions
- T-019: Restrict slash function callers to cryptographically verifiable on-chain evidence; hardcode slash amounts; clarify expiry is not slashable
- T-020: Mandate Solidity 0.8+ for checked arithmetic; add Foundry invariant test requirement for session counter bounds

**Meaningful protocol addition:**
- T-024: Resharing Phase 2 confirmations move on-chain. Each operator calls `confirmResharing(epoch, sig)` directly on the AVS contract. The contract counts confirmations and emits `ResharingCompleted(epoch)` when all N are received. The coordinator becomes a watcher, not a bottleneck. This eliminates the coordinator SPOF in the highest-stakes protocol step and makes all slashing evidence self-consistent from chain state alone.

**Event spec addition:**
- T-028: Define the `SuccessionPublished` event structure with `indexed agentPubkey`, 6-block finality wait before cache invalidation, and explicit rules for WebSocket-vs-poll fallback strategy.

## Modified Capabilities

- `on-chain-session` — T-016, T-019, T-020
- `frost-dkg` — T-003, T-001/T-004 clarification
- `threshold-signing` — T-001/T-004 clarification
- `key-succession` — T-024 on-chain resharing confirmations
- `verification-protocol` — T-028 SuccessionPublished event

## Why Now

T-016 (reentrancy) and T-019 (slash access) are the most pressing: both affect the contract security surface that must be audited before mainnet. T-024 (coordinator SPOF in resharing) is the most architecturally significant — the resharing ceremony is the only operation that can permanently destroy the agent's key if interrupted, and the current coordinator-in-the-loop design creates a recoverable but painful failure mode that can be eliminated with a small on-chain change.
