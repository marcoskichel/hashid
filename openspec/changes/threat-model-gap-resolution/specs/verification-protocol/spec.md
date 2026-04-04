## MODIFIED Requirements

### Requirement: Verifier public key cache — SuccessionPublished event specification

The `SuccessionRegistry` contract SHALL emit the following event when a succession entry is written on-chain:

```solidity
event SuccessionPublished(
    bytes32 indexed agentPubkey,   // indexed: enables per-agent log filtering at the RPC node
    bytes32 newPubkey,             // verifier updates its cache immediately from this field
    uint256 timestamp,             // for TTL comparison
    uint256 blockNumber            // for re-org detection
);
```

The `indexed agentPubkey` field is load-bearing for verifier scalability. Without it, verifiers must parse all succession events globally and filter in-process — O(all agents) per event. With it, verifiers subscribe per-agent: `{ topics: [keccak256("SuccessionPublished(bytes32,bytes32,uint256,uint256)"), agentPubkeyPadded] }` where `agentPubkeyPadded` is the 32-byte left-padded pubkey.

**Cache invalidation rules:**

1. **TTL (hard backstop):** The 5-minute TTL is the primary correctness guarantee. Every verifier implementation MUST enforce it regardless of event delivery status. A cached key older than 5 minutes MUST be treated as stale and the succession chain re-walked before use.

2. **WebSocket subscription (SHOULD):** Verifier implementations SHOULD subscribe to `SuccessionPublished` via WebSocket for low-latency cache invalidation. On event receipt, the verifier updates its cache for `event.agentPubkey → event.newPubkey` immediately — subject to the re-org finality rule below.

3. **Re-org handling:** Verifiers SHALL wait until a `SuccessionPublished` event is at least 6 blocks deep before treating it as final (`currentBlock - event.blockNumber >= 6`). During the 6-block finality window, the verifier continues using the old cached key. The old key remains valid until the succession is finalized on-chain; using it during the uncertainty window is safe and correct.

4. **Polling fallback (SHOULD):** Verifier implementations SHOULD poll `eth_getLogs` for `SuccessionPublished` events scoped to their cached agent set at least every 60 seconds, as a resilience measure under WebSocket connection loss. Combined with the 5-minute TTL, this guarantees a maximum staleness bound of 6 minutes under WebSocket outage.

The TTL and polling fallback are specified as the authoritative guarantees. WebSocket subscriptions are an optimization, not a correctness dependency.

#### Scenario: SuccessionPublished is emitted on succession entry write
- **WHEN** `revealSuccession` confirms a new succession entry on-chain
- **THEN** the contract emits `SuccessionPublished(agentPubkey, newPubkey, block.timestamp, block.number)` atomically in the same transaction

#### Scenario: Cache is not invalidated on event in finality window
- **WHEN** a verifier receives a `SuccessionPublished` event where `currentBlock - event.blockNumber < 6`
- **THEN** the verifier records the pending event but does NOT invalidate its cached key; it continues using the old key and re-checks after 6 blocks

#### Scenario: Cache is invalidated on finalized event
- **WHEN** a verifier detects that a previously received `SuccessionPublished` event has reached depth >= 6 blocks without being re-org'd
- **THEN** the verifier invalidates its cached key for `event.agentPubkey` and updates to `event.newPubkey`

#### Scenario: TTL expires without event delivery
- **WHEN** 5 minutes elapse since a verifier last resolved the succession chain for an agent, and no `SuccessionPublished` event has been received (e.g., WebSocket outage)
- **THEN** the verifier re-walks the succession chain from the on-chain registry before using the public key for signature verification; the stale cached key is not used

#### Scenario: Poll fallback bounds staleness under WebSocket outage
- **WHEN** a verifier's WebSocket connection drops and is not restored within 60 seconds
- **THEN** the polling loop fires, fetches `eth_getLogs` for `SuccessionPublished` events, and processes any events received since the last poll; combined with the 5-minute TTL, the maximum key staleness is bounded at 6 minutes
