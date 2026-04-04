## 1. New Capability: protocol-economics/spec.md

- [ ] 1.1 Write canonical economic parameters requirement: stake tiers (50 ETH baseline, 100 ETH financial, supplemental pool for high-value), with coverage ceiling formula and disclosure requirement
- [ ] 1.2 Write slash calibration requirement: all 7 slashable conditions with amounts as compile-time constants; include attacker-gain derivation rationale as spec commentary
- [ ] 1.3 Write fee structure requirement: bootstrap DKG fee ($30 L2 launch / $200 growth), signing session fee ($8–$12/session), resharing fee ($50–$100/event), succession fee ($20–$100/event)
- [ ] 1.4 Write fee distribution requirement: 70% operators / 20% treasury / 10% EigenLayer for session fees; 80% operators / 20% treasury for bootstrap and resharing fees
- [ ] 1.5 Write slash proceeds distribution requirement: 50% burned / 30% treasury / 20% fraud-proof submitter; applies to all slashable conditions
- [ ] 1.6 Write verifier bond tiers requirement: 0.2 ETH floor, 0.5 ETH standard, 2 ETH high-value; agent-declared minimum stored in AnchorIdentity record; operators reject verifiers below declared minimum before `initSession`
- [ ] 1.7 Write watcher market requirement: any address that successfully submits a valid fraud proof SHALL receive 20% of the resulting slash amount; this reward SHALL be documented in the contract interface and verified in audit
- [ ] 1.8 Write minimum N requirement: N SHALL be at least 10 for production agent deployments; deployments with N < 10 SHALL be documented as non-production and the CLI SHALL warn accordingly
- [ ] 1.9 Write maximum coverable value disclosure requirement: the CLI and documentation SHALL compute and display the coverage ceiling `= K × operator_stake × max_slash_fraction / 2` for the agent's operator set; agents with assets above the ceiling SHALL receive an explicit warning at bootstrap time
- [ ] 1.10 Write ETH-native decision: all fees, bonds, and rewards SHALL be denominated and paid in ETH; no protocol-specific token is introduced in this phase
- [ ] 1.11 Write reward distribution mechanics requirement: session fees accumulate in `SessionRegistry` escrow; weekly Merkle reward roots are submitted to EigenLayer `RewardCoordinator`; operators claim accumulated rewards in batch, not per-session; this reduces reward-distribution gas by ~100× vs. per-session pushes
- [ ] 1.12 Write anchor operator program parameters: genesis operator minimum guarantee ($2,000/operator/month for 12 months), 9-operator ceiling, target profile (established EigenLayer operators with existing infra), treasury commitment cap ($216,000)
- [ ] 1.13 Write agent subsidy parameters: first 1,000 agents receive gas rebate; agent pays $50 symbolic fee; treasury covers remaining bootstrap gas; treasury commitment cap ($109,000)

## 2. Modified: on-chain-session/spec.md

- [ ] 2.1 Add requirement: verifier deposits session fee at `initSession` — fee is held in `SessionRegistry` escrow until the session is closed; the fee amount SHALL be at least the protocol-configured minimum session fee or the `initSession` call SHALL revert
- [ ] 2.2 Add requirement: on `spendSession` success (5 valid signatures), the escrowed session fee is credited to the K participating operators' claimable balances pro-rata (equal share per operator); the treasury's cut and EigenLayer's cut are deducted first
- [ ] 2.3 Add requirement: on session expiry without spending — 50% of the escrowed fee is burned (`address(0)` transfer), 50% is credited equally to operators who submitted valid `acknowledgeSession` within the window; verifier receives nothing from the expired session fee
- [ ] 2.4 Add requirement: verifier bond minimum is enforced by the `AnchorIdentity` record — if the target agent has declared a `minVerifierBond` field, `initSession` SHALL revert if `verifierBondBalance[msg.sender] < agent.minVerifierBond`
- [ ] 2.5 Add requirement: `SessionRegistry` exposes `claimOperatorBalance()` for operators to withdraw accumulated session fee credits; no per-session ETH push; pull-payment only
- [ ] 2.6 Add requirement: `slashSessionAbandonment` slash amount is **50% of the verifier's bond** (compile-time constant fraction, not a fixed ETH amount); this scales with bond tier
- [ ] 2.7 Add requirement: 20% of each slash event's recovered bond SHALL be transferred to the address that called `slashSessionAbandonment` (watcher reward); the remaining 50% of the total slash (50% of bond = the other half) is burned; net: 20% of bond to watcher, 30% burned, 50% refunded to verifier's remaining balance (or netted against it)
- [ ] 2.8 Unit tests:
  - `initSession` reverts if fee deposit < minimum session fee
  - `initSession` reverts if `verifierBondBalance[caller] < agent.minVerifierBond`
  - `spendSession` credits K operators equally after treasury and EigenLayer deductions
  - Session expiry: 50% of fee burned, 50% to acknowledging operators; verifier receives zero
  - `claimOperatorBalance` transfers correct accumulated amount
  - `slashSessionAbandonment` awards 20% to caller, burns 30% of bond, updates verifier balance

## 3. Modified: coordinator-accountability/spec.md

- [ ] 3.1 Add requirement: minimum operator stake — operators SHALL register with at least 50 ETH restaked in the HashID AVS. Operators serving agents with declared value ceiling above $500k SHALL stake at least 100 ETH. The `ServiceManager.registerOperator()` call SHALL revert if the operator's EigenLayer restaked balance does not meet the tier-appropriate minimum
- [ ] 3.2 Add requirement: slash amounts as compile-time constants:
  ```
  SLASH_NONCE_REUSE       = 75 ETH
  SLASH_BAD_SHARE         = 6 ETH
  SLASH_NON_ACKNOWLEDGMENT = 0.1 ETH per event
  SLASH_NON_CONFIRMATION  = 5% of operator stake per event
  SLASH_MISSING_DELETION  = 1 ETH (first two), 5 ETH (third and subsequent)
  SLASH_EQUIVOCATION      = 100% of operator stake
  ```
  No setter or governance function SHALL modify these values post-deployment
- [ ] 3.3 Add new slashable condition: `slashEquivocation(operator_id, session_id_a, sig_a, session_id_b, sig_b)`. The contract SHALL verify both signatures under the operator's AVS key, confirm that both `session_id` values reference OPEN or SPENT sessions in `SessionRegistry`, and slash 100% of the operator's stake. An operator that co-signs messages under two different session contexts — or that produces a signature for a payload not traceable to any `SessionRegistry` session — has demonstrated equivocation
- [ ] 3.4 Add requirement: participation rate for fee eligibility — operators SHALL achieve a minimum participation rate of **95% of VRF-assigned sessions** within a rolling 30-day epoch. The `ServiceManager` tracks per-operator selection count and acknowledgment count. Operators below the 95% threshold in a given epoch are excluded from that epoch's reward root. They remain in the operator set (not deregistered) but receive zero session fee income for that epoch
- [ ] 3.5 Add requirement: slash proceeds distribution — for every slash event:
  - 20% to the address that submitted the valid slash proof (watcher incentive)
  - 30% to the protocol treasury address
  - 50% burned (transferred to `address(0)`)
  This distribution applies to all slash functions: `slashNonceReuse`, `slashBadShare`, `slashNonAcknowledgment`, `slashNonConfirmation`, `slashMissingDeletion`, `slashEquivocation`, `slashSessionAbandonment`
- [ ] 3.6 Add requirement: watcher reward documentation — the 20% watcher reward SHALL be prominently documented in the contract NatSpec and in the CLI help text for `hashid watch`. This creates a discoverable incentive for third-party monitoring
- [ ] 3.7 Add requirement: escalating deletion slash — a `MissingDeletionTracker` mapping records per-operator missed deletion attestation count. The slash for a third or subsequent missed attestation is **5 ETH** (vs. 1 ETH for the first two). The tracker resets on a successful deletion attestation
- [ ] 3.8 Unit tests:
  - `registerOperator` reverts below 50 ETH restaked
  - `slashNonceReuse` slashes 75 ETH and distributes 20/30/50% correctly
  - `slashEquivocation` slashes 100% of stake
  - `slashEquivocation` reverts if either session is not in `SessionRegistry`
  - Participation rate below 95% excludes operator from reward root; operator remains in set
  - Escalating deletion slash: 1st miss = 1 ETH, 2nd = 1 ETH, 3rd = 5 ETH, resets on successful attestation
  - `slashBadShare` distributes watcher reward correctly

## 4. AnchorIdentity: agent-declared economic parameters

- [ ] 4.1 Add `minVerifierBond: uint96` field to the `AnchorIdentity` on-chain record — allows agents to declare their required minimum verifier bond; enforced by `SessionRegistry` at `initSession`
- [ ] 4.2 Add `coverageCeiling: uint256` documentation field (off-chain, not on-chain) — computed and displayed by the CLI at bootstrap and on `hashid status`; formula: `K × operatorStake × maxSlashFraction / 2`; displayed with an explicit warning if agent-declared asset value exceeds the ceiling
- [ ] 4.3 CLI: `hashid bootstrap` SHALL prompt the deployer for their agent's declared value tier (general / financial / high-value) and compute the required operator minimum stake; if the proposed operator set does not meet the tier's stake requirement, bootstrap SHALL fail with an explicit error before initiating the DKG ceremony
- [ ] 4.4 CLI: `hashid status` SHALL display current coverage ceiling, operator set stake, and a warning if any operator is below the tier-appropriate minimum stake
- [ ] 4.5 Unit tests:
  - `initSession` reverts if verifier bond < `agent.minVerifierBond`
  - CLI bootstrap fails with useful error message when operator set below required stake tier
  - `hashid status` coverage ceiling calculation matches formula

## 5. ZK spendSession prerequisite (track as dependency)

- [ ] 5.1 Create a separate engineering change for the Groth16 batch Ed25519 verifier contract
- [ ] 5.2 The protocol-economics fee structure at the $8–$12/session target is predicated on ZK verification; document this as a blocking dependency in the `protocol-economics` spec
- [ ] 5.3 The mainnet launch fee structure (non-ZK) SHALL be documented separately: session fee = $30–$40 (to cover $15 ZK-less `spendSession` gas + operator margin); this is a transitional fee that must decrease once ZK is deployed
- [ ] 5.4 CLI `hashid bootstrap` SHALL display whether the currently deployed `spendSession` is ZK-optimized or legacy, and the resulting expected session fee

## 6. Cold-Start Program Documentation

- [ ] 6.1 Document anchor operator program parameters in `docs/operator-economics.md`: minimum guarantee ($2,000/month, 12 months, 9-operator ceiling), application criteria, treasury commitment cap
- [ ] 6.2 Document agent subsidy parameters: first 1,000 agents, $50 symbolic fee, gas rebate mechanics, treasury commitment cap ($109,000)
- [ ] 6.3 Document sustainability model: break-even at ~511 agents (20 sessions/month, $10/session, L2); target for comfortable surplus: 1,000 agents
