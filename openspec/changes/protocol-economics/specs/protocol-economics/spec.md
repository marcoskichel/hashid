## ADDED Requirements

### Requirement: ETH-native fee denomination
All fees, bonds, slashes, and rewards in the HashID protocol SHALL be denominated and settled in ETH. No protocol-specific token is used in this phase. This decision aligns with EigenLayer's ETH-native restaking model and eliminates token speculation from operator incentive structures.

#### Scenario: Session fee paid in ETH
- **WHEN** a verifier calls `initSession`
- **THEN** the verifier deposits ETH (at or above the minimum session fee) into `SessionRegistry` escrow; no other asset is accepted

### Requirement: Operator stake tiers

Operators registering with the HashID AVS SHALL meet the minimum restaked ETH stake for the tier appropriate to the agents they serve:

| Tier | Minimum stake | Applies when |
|------|--------------|-------------|
| **Baseline** | 50 ETH | All operators; covers agents with asset value ≤ $500k at design-case ETH price |
| **Financial** | 100 ETH | Operators serving agents that declare a financial tier via `minVerifierBond ≥ 0.5 ETH` in AnchorIdentity |
| **High-value** | Baseline stake + supplemental bonding pool | Operators serving agents with assets above the baseline coverage ceiling |

The `ServiceManager.registerOperator()` call SHALL revert if the operator's EigenLayer restaked balance does not meet the applicable tier minimum at registration time.

**Coverage ceiling formula:** The protocol provides slashing-based economic deterrence up to a computable ceiling. The CLI SHALL compute and display this at bootstrap:

```
coverage_ceiling = K × operator_stake × max_slash_fraction / 2
```

For the baseline tier (50 ETH stake, 100% equivocation slash, K=7, 2× safety margin):
`coverage_ceiling = 7 × 50 × 1.0 / 2 = 175 ETH ≈ $525,000`

Agents with declared asset values above the coverage ceiling SHALL receive an explicit warning at bootstrap time. The CLI SHALL not fail silently when this condition is detected.

**Minimum N=10 for production deployments.** The `DKGInit` call on behalf of a production agent SHALL revert if the proposed operator set has fewer than 10 members. The CLI SHALL label deployments with N < 10 as non-production and surface an explicit warning. This requirement is grounded in game-theoretic analysis: N=5 K=4 collusion is attacker-favorable at baseline stake; N=10 K=7 is clearly defender-favorable.

#### Scenario: Operator below tier minimum is rejected at registration
- **WHEN** an operator calls `registerOperator` with insufficient restaked ETH for the applicable tier
- **THEN** the `ServiceManager` reverts with an insufficient-stake error; the operator is not added to the eligible set

#### Scenario: Bootstrap warning when coverage ceiling is exceeded
- **WHEN** a deployer runs `hashid bootstrap` and the declared agent value exceeds `K × operator_stake × 50% / 2`
- **THEN** the CLI displays: "WARNING: Your agent's declared value ($X) exceeds the slashing coverage ceiling ($Y) for this operator set. Consider a supplemental bonding pool or upgrade to the financial operator tier."

### Requirement: Slash calibration table

All slash amounts are compile-time constants in the contract bytecode. No governance parameter or storage variable controls slash amounts post-deployment. Changing slash amounts requires a new contract deployment.

Slash amounts are calibrated to a design-case attack value of $1,000,000 (representative high-value agent). The calibration formula is: `slash_amount = (expected_gain / detection_probability) × 1.5× safety_margin`.

| Slashable condition | Constant name | Amount | Calibration basis |
|--------------------|---------------|--------|------------------|
| Nonce reuse | `SLASH_NONCE_REUSE` | 75 ETH | Marginal gain = $143k; P(detect) = 0.95; 1.5× safety |
| Bad share / ceremony sabotage | `SLASH_BAD_SHARE` | 6 ETH | Gain = delay ~$10k; P(detect) = 0.90 |
| Non-acknowledgment of session | `SLASH_NON_ACKNOWLEDGMENT` | 0.1 ETH | Liveness failure; P(detect) = 1.00 |
| Non-confirmation of resharing | `SLASH_NON_CONFIRMATION` | 5% of operator stake per event | Catastrophic if key is lost; P(detect) = 0.99 |
| Missing deletion attestation | `SLASH_MISSING_DELETION_1` / `SLASH_MISSING_DELETION_N` | 1 ETH (1st–2nd miss), 5 ETH (3rd+) | Escalating deterrent |
| Off-session co-signing / equivocation | `SLASH_EQUIVOCATION` | 100% of operator stake | Maximum deterrent; hard to detect (P ≈ 0.60) |
| Session abandonment (verifier) | `SLASH_ABANDONMENT_FRACTION` | 50% of verifier bond | Scales with bond tier |

#### Scenario: Slash amounts cannot be modified by governance
- **WHEN** any address calls a slash-amount setter function
- **THEN** no such function exists; the call reverts at the ABI level; slash amounts can only change via a new contract deployment

### Requirement: Slash proceeds distribution

For every slash event (all slashable conditions), the recovered amount SHALL be distributed as follows:

- **20%** to the address that successfully submitted the valid slash proof (watcher incentive)
- **30%** to the protocol treasury address
- **50%** burned (transferred to `address(0)`)

This distribution applies to: `slashNonceReuse`, `slashBadShare`, `slashNonAcknowledgment`, `slashNonConfirmation`, `slashMissingDeletion`, `slashEquivocation`, `slashSessionAbandonment`.

The 20% watcher reward SHALL be prominently documented in the contract NatSpec and in the CLI help text for `hashid watch`. This creates a discoverable incentive for third-party monitoring infrastructure.

#### Scenario: Watcher receives reward on successful fraud proof
- **WHEN** an address calls `slashNonceReuse` with valid cryptographic evidence and the operator is slashed
- **THEN** the contract transfers 20% of the slashed amount to the caller's address atomically in the same transaction, before emitting the slash event

#### Scenario: Slash proceeds distribution is auditable
- **WHEN** a slash event occurs
- **THEN** the contract emits `SlashDistributed(slashee, watcher, watcherAmount, treasury, treasuryAmount, burned)` enabling off-chain verification of correct distribution

### Requirement: Fee structure

**Bootstrap DKG fee (agent pays, one-time per agent identity):**
The fee is paid at `DKGInit` and held in escrow until the ceremony completes. On `AnchorIdentity` confirmation, the fee is distributed: 80% equally among the N participating operators, 20% to the treasury. On ceremony abort, the fee is refunded to the agent minus a non-refundable ceremony-initiation gas rebate to operators.

| Deployment phase | Nominal fee |
|-----------------|------------|
| L2 launch | $30 (gas-dominant; minimal protocol margin) |
| Growth phase | $200 (full protocol margin) |

**Signing session fee (verifier pays, per session):**
The fee is deposited at `initSession`. Target range: **$8–$12 per session** on L2 post-ZK. This fee is predicated on ZK-optimized `spendSession` (~250k gas = $0.04 on L2). The pre-ZK transitional fee is **$30–$40** to cover unoptimized gas costs. The CLI and contract documentation SHALL clearly indicate which fee tier applies.

**Resharing fee (agent pays, per resharing ceremony):**
Paid at `authorizeResharing`. Range: **$50–$100 per event**. Distribution: 80% to N participating operators, 20% to treasury.

**Succession fee (agent pays, per key rotation):**
Paid at `commitSuccession`. Range: **$20–$100 per event**. Distribution: 80% to operators who participate in any required signing (e.g., `initiateSuccessionWithEndorsement`), 20% to treasury. If no operator signing is required (standard commit-reveal path), 100% to treasury.

#### Scenario: Session fee deposit is mandatory
- **WHEN** a verifier calls `initSession` with ETH value below the minimum session fee
- **THEN** the contract reverts with an insufficient-fee error; no session is created

### Requirement: Fee distribution model

Per signing session fee split:
- **70%** to the pool of K participating operators (equal share per operator)
- **20%** to the protocol treasury
- **10%** to EigenLayer protocol fee (via `RewardCoordinator`)

Operator rewards accumulate in `SessionRegistry` credited balances. Weekly, the protocol submits a Merkle reward root to EigenLayer's `RewardCoordinator`. Operators claim accumulated rewards by calling `RewardCoordinator.claim()` using their EigenLayer operator identity. Per-session ETH pushes to operators are prohibited — only pull-payment via weekly claim roots.

#### Scenario: Operator reward is batched, not per-session
- **WHEN** 1,000 session fees accumulate over a week
- **THEN** the protocol computes a Merkle root of operator shares and submits one `submitRewardRoot` transaction; operators claim their share at their convenience; no individual session triggers an ETH transfer to operators

### Requirement: Verifier bond tiers

Verifier bond tiers are enforced at `initSession`. Agents declare their minimum required verifier bond in the `AnchorIdentity` record (`minVerifierBond: uint96`). Operators enforce the declared minimum by reading the AnchorIdentity record before accepting session creation.

| Tier | Bond amount | Agent declaration |
|------|------------|------------------|
| Floor | 0.2 ETH | Default; applies when no `minVerifierBond` is declared |
| Standard | 0.5 ETH | `minVerifierBond = 0.5 ETH` |
| High-value | 2 ETH | `minVerifierBond = 2 ETH`; recommended for financial and infrastructure agents |

Verifier bonds are held in `SessionRegistry` escrow. The bond is refundable in full when the verifier deregisters, provided no outstanding slash obligations exist.

#### Scenario: Verifier below agent-declared bond minimum is rejected
- **WHEN** a verifier with `bondBalance = 0.1 ETH` calls `initSession` for an agent with `minVerifierBond = 0.5 ETH`
- **THEN** the contract reverts with an insufficient-bond error

### Requirement: Operator participation rate for fee eligibility

Operators SHALL achieve a minimum participation rate of **95% of VRF-assigned sessions** within a rolling 30-day epoch. An "assigned session" is one where the operator appears in the VRF-sampled K for that session. A "participated session" is one where the operator submitted a valid `acknowledgeSession` within the 2-minute window.

The `ServiceManager` tracks `sessionsAssigned[operator]` and `sessionsParticipated[operator]` per epoch. At epoch close, operators with `sessionsParticipated / sessionsAssigned < 0.95` are excluded from that epoch's Merkle reward root. They remain in the active operator set — this is a revenue exclusion, not a deregistration.

Operators who fall below the participation threshold for **three consecutive epochs** SHALL be eligible for removal from the active operator set by protocol governance.

#### Scenario: Low participation rate excludes operator from epoch rewards
- **WHEN** an operator participated in 90% of VRF-assigned sessions in a 30-day epoch
- **THEN** the operator is excluded from the epoch's reward root; they receive zero session fee income for that epoch; they are not deregistered or slashed

#### Scenario: Operator above threshold receives full share
- **WHEN** an operator participated in 97% of VRF-assigned sessions
- **THEN** the operator is included in the epoch's reward root at full weight

### Requirement: Cold-start anchor operator program

The protocol SHALL document and fund an anchor operator program for the genesis phase:

- **Guaranteed minimum**: $2,000/operator/month for 12 months, regardless of session volume
- **Maximum cohort**: 9 anchor operators
- **Total treasury commitment**: $216,000 (funded from seed treasury before mainnet launch)
- **Target profile**: established EigenLayer operators with existing infrastructure and demonstrated operational uptime
- **Benefits**: guaranteed minimum payout, preferential registry listing, early-adopter recognition

The anchor operator program terminates at 12 months or when organic session revenue covers operator costs (whichever comes first), whichever is later.

### Requirement: Agent bootstrap subsidy (genesis phase)

The first **1,000 agents** bootstrapped on the protocol SHALL receive a gas rebate:

- Agent pays a symbolic $50 fee at bootstrap (spam prevention)
- Protocol treasury covers remaining bootstrap gas costs (~$109 at mainnet, ~$30 at L2)
- Total treasury commitment cap: $109,000
- The subsidy applies to the DKG ceremony gas only; EigenDA write cost is always paid by the agent

The subsidy is tracked on-chain via a counter in the `AnchorIdentity` contract. Once the counter reaches 1,000, subsequent bootstraps pay the full fee.
