## MODIFIED Requirements

### Requirement: SessionRegistry contract version and arithmetic safety
The `SessionRegistry` contract SHALL target Solidity 0.8 or later. Checked arithmetic is the default in Solidity 0.8+; no `unchecked` blocks SHALL appear in any counter-tracking or balance-tracking code path. Session status SHALL be represented as a three-value enum `{ OPEN, SPENT, EXPIRED }`, where `OPEN → EXPIRED` transitions are lazy (evaluated at `initSession` time when sweeping capacity) and `OPEN → SPENT` transitions are explicit (on `spendSession`). The open session counter SHALL be decremented exactly once per transition, guarded by the enum state, preventing any double-decrement path.

The following Foundry invariant test SHALL be implemented and maintained:

```solidity
function invariant_sessionCountBounded() public view {
    for (uint256 i = 0; i < allVerifiers.length; i++) {
        assertLe(openSessionCounts[allVerifiers[i]], MAX_OPEN_SESSIONS);
        assertGe(openSessionCounts[allVerifiers[i]], 0);
    }
}
```

#### Scenario: Session counter is always bounded
- **WHEN** any sequence of `initSession`, `spendSession`, and expiry operations is executed against any set of verifiers
- **THEN** `openSessionCounts[v] <= MAX_OPEN_SESSIONS` and `openSessionCounts[v] >= 0` hold for all verifiers `v` after every transaction

### Requirement: Session spending — reentrancy protection and CEI ordering
The `SessionRegistry` contract SHALL protect all state-mutating session functions with OpenZeppelin `ReentrancyGuard.nonReentrant`: `initSession`, `spendSession`, `acknowledgeSession`, `slashNonAcknowledgment`, `slashSessionAbandonment`.

`spendSession` SHALL apply mutations in strict checks-effects-interactions order:
1. **Checks**: `require(session.status == OPEN)`, `require(msg.sender == session.verifierAddress)`, verify all 5 Ed25519 signatures
2. **Effects**: `session.status = SPENT`, `openSessionCount[msg.sender] -= 1`
3. **Interactions**: emit `SessionSpent` event; then any bond credit or external call

`session.status = SPENT` SHALL be the first state write, applied before the signature verification loop completes and before any external call or token transfer.

Bond refunds SHALL use a pull-payment pattern. `spendSession` and slash functions SHALL NOT transfer ETH directly to any address. Verifiers and operators claim bond balances by calling a separate `withdrawBond()` function. This eliminates the reentrancy surface from the hot path for any path involving external fund transfers.

Note: `nonReentrant` does not block cross-contract reentrancy via third-party contracts (e.g., EigenLayer slash callbacks that re-enter `SessionRegistry` via a separate call path). The CEI ordering is the load-bearing protection. Any EigenLayer slash callback that may be invoked during a slash function SHALL be audited to confirm it cannot loop back into `SessionRegistry`.

#### Scenario: Reentrancy via malicious verifier fallback is blocked
- **WHEN** a malicious verifier contract's fallback re-enters `spendSession` during the execution of the original call
- **THEN** the `nonReentrant` guard reverts the inner call; the outer call's state mutations are already complete (CEI ordering ensures `status: SPENT` was written before any external call could be reached)

#### Scenario: Bond refund is not transmitted in spendSession
- **WHEN** `spendSession` is called with 5 valid signatures
- **THEN** no ETH is transferred by `spendSession`; the verifier's claimable bond balance is updated in storage only; the verifier must call `withdrawBond()` separately to receive funds

### Requirement: Slash function access control and amount specification
Slash functions (`slashNonAcknowledgment`, `slashSessionAbandonment`, `slashNonConfirmation`, `slashMissingDeletion`, `slashBadShare`, `slashNonceReuse`) SHALL require cryptographically verifiable on-chain evidence. The contract verifies the evidence independently — the caller's identity is not a factor; any address may call these functions provided they supply valid cryptographic evidence. No whitelist of authorized callers is maintained. The contract's evidence verification is the access control.

Slash amounts SHALL be compile-time constants defined in the contract bytecode:

```solidity
uint256 private constant ABANDONMENT_SLASH_AMOUNT = ...;
uint256 private constant NON_ACKNOWLEDGMENT_SLASH_AMOUNT = ...;
uint256 private constant BAD_SHARE_SLASH_AMOUNT = ...;
```

No governance parameter, no storage variable, and no admin function SHALL control slash amounts after deployment. Changing slash amounts requires deploying a new contract version.

`slashSessionAbandonment` SHALL require `block.timestamp > session.createdAt + SESSION_EXPIRY + 60 seconds`. The 60-second `SLASH_BUFFER` prevents validator timestamp manipulation near the expiry boundary from mis-classifying sessions that expired legitimately.

Session expiry with `status: OPEN` SHALL NOT trigger any bond reduction or slash. Normal session expiry is not misbehavior. Bond reductions occur only on explicit misbehavior proofs (abandonment threshold crossed, non-acknowledgment proven, nonce reuse proven).

#### Scenario: Slash requires valid cryptographic evidence
- **WHEN** `slashNonAcknowledgment` is called for an operator that submitted a valid `acknowledgeSession`
- **THEN** the contract verifies the acknowledgment exists on-chain and reverts with an already-acknowledged error; no slash occurs regardless of who called the function

#### Scenario: Session expiry does not reduce bond
- **WHEN** a verifier's sessions expire unspent (fewer than 3 in any 60-minute window)
- **THEN** no bond reduction occurs; the verifier retains their full bond balance; only the rate-limit slot is consumed

#### Scenario: Slash amount is not configurable
- **WHEN** a governance transaction attempts to modify the slash amount for `slashNonAcknowledgment`
- **THEN** no such setter function exists; the slash amount is a compiled-in constant; the transaction is rejected at the ABI level
