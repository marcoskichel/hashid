# Design: Protocol Economics

## Economic Actors

Five principals with distinct objectives and time horizons:

| Actor | Objective | Time horizon |
|-------|-----------|-------------|
| **Operators** | Maximize risk-adjusted yield on restaked ETH; minimize infra/op cost; avoid slash | Long (staked capital at risk) |
| **Agent deployers** | Verifiable agent identity at minimum cost; zero tolerance for key loss or availability failure | Long (identity is infrastructure) |
| **Verifiers** | Authenticate agent on demand; pay per verification; bond refundable | Transactional |
| **EigenLayer** | Grow TVL; collect protocol fee on AVS operator rewards | Long |
| **Protocol governance** | Grow agent registrations and verification volume; sustain operator rewards | Long |

---

## On-Chain Cost Model

All figures: L2 (Base / Arbitrum One), 0.05 gwei, ETH = $3,000. Mainnet figures in parentheses at 20 gwei.

| Operation | Gas | L2 cost | Mainnet cost | Who pays |
|-----------|-----|---------|-------------|----------|
| `initSession` | 180k | $0.027 | $10.80 | Verifier |
| `acknowledgeSession` × K=7 (batched Merkle) | 60k | $0.009 | $3.60 | Operators (absorbed) |
| `spendSession` (ZK Groth16 proof) | 250k | $0.038 | $15.00 | Verifier |
| **Session total** | **490k** | **~$0.07** | **~$29** | Verifier |
| `AnchorIdentity` | 150k | $0.023 | $9.00 | Agent |
| EigenDA identity write | — | $30 | $30 | Agent |
| `DKGInit` + ceremony acks + confirmations | 1.1M | $0.17 | $109 | Agent |
| **Bootstrap total** | — | **~$30** | **~$109** | Agent (one-time) |
| `commitSuccession` + `revealSuccession` | 540k | $0.08 | $32 | Agent (rare) |

**The ZK prerequisite in numbers:** `spendSession` without ZK = 2.5M gas = $156 mainnet / $0.38 L2. With ZK = 250k gas = $15 mainnet / $0.04 L2. The session fee structure below assumes the ZK-optimized version. The non-ZK cost makes mainnet deployment of signing sessions economically unviable for any verification under ~$30 in value.

---

## Operator Stake Tiers

Minimum stake is calibrated against the design-case attack value. The base design-case is **$1,000,000** — a representative high-value agent controlling ~$500k in assets with $50k/year identity-dependent business value.

| Tier | Agent type | Minimum operator stake | Rationale |
|------|-----------|----------------------|-----------|
| **Baseline** | General-purpose agents, value ≤ $500k | **50 ETH** (~$150k) | Bribe cost for K=7 operators > $1M attack value with 2× safety margin |
| **Financial** | Agents controlling wallets or DeFi positions, value $500k–$5M | **100 ETH** (~$300k) | Scales linearly with agent value ceiling |
| **Protocol** | Agents with governance or treasury signing authority, value $5M+ | **Supplemental bonding pool** — see below |

**Supplemental bonding pool (high-value agents):** Agents declaring a value ceiling above the baseline tier's coverage (`K × operator_stake × max_slash_fraction`) SHALL register a supplemental bond in the `AnchorIdentity` record. Operators serving these agents must verify the supplemental bond is funded before accepting DKG participation. The bond is held in a dedicated escrow contract, separate from operator stakes.

**Why 50 ETH baseline?** The attack economist's derivation: for N=10 K=7, minimum bribe per operator = operator's forward revenue NPV ($23k) + expected slash cost (0.95 × 50 ETH × $3k = $142.5k) = ~$165.5k. Total 7-operator bribe = $1.16M > $1M attack value. The 2× safety margin accounts for the coordination overhead required to recruit 7 independent parties.

**Minimum N=10 for production deployments.** At N=5 K=4, four-party collusion costs $536k against a $1M target — attacker-favorable (griefing ratio 0.54×). At N=10 K=7, seven-party collusion costs $1.45M — clearly defender-favorable. The concentration limit (`N - K` max seats per address) must be enforced.

---

## Slash Calibration

Fundamental constraint: `P(detection | misbehavior) × slash_amount > E[gain | misbehavior]`. All slash amounts are **compile-time constants** in the contract bytecode. No governance-settable parameter.

The slash amounts below are calibrated to the baseline tier ($1M design-case attack value, ETH = $3k).

| Misbehavior | Slashable condition | Attacker gain | Detection P | Slash amount | Notes |
|-------------|---------------------|--------------|-------------|-------------|-------|
| Nonce reuse | `slashNonceReuse` | 1/K of full key = $143k marginal | 0.95 | **75 ETH** | Per event; makes a K-event campaign cost $1.57M > attack value |
| Bad share / ceremony sabotage | `slashBadShare` | Ceremony delay ~$10k | 0.90 | **6 ETH** | Requires victim to decrypt + submit; 90% detection assumed |
| Non-acknowledgment of session | `slashNonAcknowledgment` | Liveness failure; no direct gain | 1.00 | **0.1 ETH** | Cumulative; repeated failures in epoch compound |
| Non-confirmation of resharing | `slashNonConfirmation` | Potential key loss event | 0.99 | **5% of operator stake per event** | Percentage-based to scale with stake tier |
| Missing deletion attestation | `slashMissingDeletion` | Latent share retention | 0.85 | **1 ETH** | Escalates to 5 ETH on third missed attestation by same operator |
| Off-session co-signing / equivocation | `slashEquivocation` | Up to $1M (key control) | 0.60 | **100% of operator stake** | Maximum deterrent; detection via on-chain session binding |
| Session abandonment (verifier) | `slashSessionAbandonment` | 30-min agent DoS | 0.90 | **50% of verifier bond** | Per event above 3-session threshold |

**Slash proceeds distribution** (all slashable conditions):
- 50% burned (ETH sent to `address(0)`) — deflationary; aligns with ETH's monetary policy
- 30% to protocol treasury — funds development and insurance reserve
- 20% to the address that submitted the fraud proof — watcher market incentive

The 20% watcher reward activates a third-party fraud-proof submission market. Without this, `slashNonceReuse` is a passive mechanism that only fires if the agent happens to be monitoring. With it, any party watching the nonce commitment archive has direct financial incentive to submit proofs.

---

## Fee Structure

### Bootstrap DKG Fee (agent pays, one-time)

Covers: N operators' participation in the FROST DKG ceremony (multiple round-trips, on-chain gas, key material handling), EigenDA identity record write, and protocol margin.

| Phase | Nominal fee |
|-------|-------------|
| L2 launch | **$30** (gas-dominant; minimal protocol margin at launch) |
| Growth phase | **$200** (higher protocol margin; covers operator coordination overhead) |

Distribution: 80% to N participating operators equally, 20% to protocol treasury. EigenLayer's cut does not apply to bootstrap fees (not a per-signing reward).

### Signing Session Fee (verifier pays, per session)

The primary revenue stream. Covers: K operators' `acknowledgeSession` participation, ZK proof generation (off-chain cost borne by the agent's proving infrastructure), and gas overhead.

| Target fee | Split | L2 post-ZK math |
|-----------|-------|-----------------|
| **$8–$12/session** | 70% operators / 20% treasury / 10% EigenLayer | At $10: operators get $7 / K = $1/operator; treasury gets $2; EigenLayer gets $1 |

Operator share per session at K=7, $10 fee: **$1.00/operator**. At L2 gas costs (~$0.04 per `acknowledgeSession`), operator margin = $1.00 - $0.04 = **$0.96 net per selection**. At 1,000 selected sessions/month per operator: $960/month net before fixed costs. Fixed costs: ~$520/month. Net margin: **+$440/month** — viable.

**Session fee escrow mechanics:**
1. Verifier deposits session fee at `initSession` — held in escrow by `SessionRegistry`
2. On `spendSession` (5 valid signatures): fee released to operator pool proportional to participation
3. On session expiry without spending: 50% of escrowed fee is burned; 50% distributed to operators who submitted valid `acknowledgeSession` in the window (they did work even if the verifier abandoned)

The burned-on-abandonment mechanics transforms session spam from a free action into a paid destruction event for the verifier.

### Resharing Fee (agent pays, per ceremony)

Covers: 2N on-chain transactions (acks + confirmations), operator participation in the new DKG ceremony, and protocol margin.

| Nominal fee |
|-------------|
| **$50–$100 per resharing event** |

Distribution: same as bootstrap (80% operators, 20% treasury). This is an infrequent event (proactive resharing on 6-month epochs or on-demand compromise response).

### Succession Fee (agent pays, on key rotation)

Covers: on-chain ZK verification for `revealSuccession`, guardian notification, and protocol overhead.

| Nominal fee |
|-------------|
| **$20–$100 per succession event** (rare; agent is cost-insensitive here) |

### Verifier Bond (tiered, refundable)

The bond is slashable on `slashSessionAbandonment`. Tiers are enforced by agents declaring their minimum required verifier bond in the `AnchorIdentity` record. Verifiers that do not meet the declared minimum are rejected by operators before `initSession`.

| Bond tier | Amount | Agent declaration |
|-----------|--------|------------------|
| **Floor** | **0.2 ETH** (~$600) | Default; all agents unless declared otherwise |
| **Standard** | **0.5 ETH** (~$1,500) | Agents expecting frequent verification |
| **High-value** | **2 ETH** (~$6,000) | Financial agents; infrastructure agents |

Bond calibration rationale: at 0.2 ETH bond, 0.90 detection, 50% slash: expected attacker cost = 0.2 × 0.90 × 50% = 0.09 ETH = $270. Victim loss from 30-minute monopolization: $50–$500. Griefing ratio: $270 / $500 = 0.54× — barely defender-favorable. At 2 ETH: $2,700 attacker cost / $5,000 victim loss = 0.54× — similar ratio at a higher absolute deterrent level.

---

## Fee Distribution Model (summary)

```
Session signing fee (100%)
├── EigenLayer protocol fee:   10%
├── HashID treasury:           20%
└── Operator pool:             70%
      └── Split equally among K participating operators
```

Bootstrap and resharing fees:
```
Bootstrap / resharing fee (100%)
├── HashID treasury:           20%
└── Participating operators:   80%
      └── Split equally among N operators in ceremony
```

Note: EigenLayer's fee is not applied to bootstrap/resharing because these are not recurring operator-signed events — they are one-time ceremony participation fees. Only per-signing-session rewards flow through EigenLayer's `RewardCoordinator`.

**Reward distribution mechanics:** Session fees accumulate in `SessionRegistry` escrow. Weekly, the protocol submits a Merkle reward root to EigenLayer's `RewardCoordinator`. Operators claim accumulated rewards from the `RewardCoordinator` using their EigenLayer identity. This batches per-session micro-payments into one weekly claim per operator — reducing gas overhead by ~100× compared to per-session reward pushes.

---

## Operator Business Model

### Monthly cost structure (per operator, 50 agents, 20 sessions/agent/month)

| Cost item | L2 estimate |
|-----------|-------------|
| Infrastructure (VPS + monitoring) | $50–$500/month |
| Stake opportunity cost (50 ETH, 4% ETH staking yield foregone) | ~$500/month |
| Gas: `acknowledgeSession` × 700 selections × $0.04 | $28/month |
| **Total fixed + variable** | **~$578–$1,028/month** |

### Monthly revenue (at $10/session, 70% operator share, K=7)

- Sessions selected: 50 agents × 20 sessions × 70% VRF = 700 sessions
- Operator share per session: $10 × 70% / 7 = $1.00
- **Monthly gross: 700 × $1.00 = $700/month**
- Net (midpoint cost): $700 - $803 = **-$103/month** — marginally underwater at 50 agents

Break-even requires either more agents or a higher session fee. At 100 agents (2× volume): $1,400 revenue, $803 cost, **+$597/month margin**.

**Minimum viable operator: ~75 agents at $10/session fee (post-ZK, L2).**

### Cold-Start: Anchor Operator Program

Pre-launch guaranteed minimums for 5–9 genesis operators:
- Guaranteed monthly minimum: **$2,000/operator/month for 12 months**
- Total treasury commitment: 9 operators × $2,000 × 12 = **$216,000**
- Target operators: established EigenLayer operators with existing infrastructure (P2P.org, Figment, Blockdaemon, Chorus One, Nethermind AVS teams)

Genesis operators receive:
1. Guaranteed minimum payout (from protocol treasury incentive pool)
2. Preferential listing in the operator registry UI
3. Early-adopter allocation if a governance token is introduced in Phase 2

**Agent subsidy:** First 1,000 agents receive bootstrapping gas rebate. Agent pays $50 symbolic fee; protocol treasury covers remaining ~$109 gas cost. Total treasury commitment: 1,000 × $109 = $109,000. Combined cold-start reserve: **~$325,000 from seed treasury**.

---

## Sustainability Analysis

| Scenario | Monthly agents | Sessions/agent/mo | Monthly gross fees | Treasury (20%) | Break-even? |
|----------|---------------|-------------------|--------------------|---------------|-------------|
| Early stage | 200 | 20 | $40,000 | $8,000 | No ($45k costs) |
| Break-even | 511 | 20 | $102,200 | $20,440 | Yes (~$45k costs) |
| Sustainable | 1,000 | 20 | $200,000 | $40,000 | Yes (+ surplus) |
| Scale | 5,000 | 20 | $1,000,000 | $200,000 | Well funded |

Break-even point: **~511 agents at 20 sessions/month** at $10/session and 20% treasury share.

The protocol is highly sensitive to session frequency — registered agents that don't generate verification sessions produce zero recurring revenue. The business model requires agents that are *actively used* for real-world authentication, not just registered.

---

## Token vs. ETH-Native Decision

**ETH-native at launch.** Rationale:

- EigenLayer is ETH-native; operators are already denominated in ETH; a protocol token adds a conversion layer that operators will resist
- No token speculation distorts operator incentives — they are paid for work, not for holding a volatile asset
- Launching a token before product-market-fit creates securities risk and requires liquidity/market-making infrastructure before it is needed
- The cold-start bootstrap problem is solvable with a seed treasury in ETH ($325k) — a token is not required for this

**Governance token at Phase 2 (2,000+ agents, PMF demonstrated).** The token's primary use case is on-chain governance of fee parameters and operator requirements — not monetary utility. Structuring it as a governance token only (voting power, no staking yield, no fee capture) reduces regulatory exposure while enabling decentralized parameter updates.

---

## Maximum Coverable Agent Value

The protocol provides slashing-based economic deterrence up to a computable ceiling. Deployers of high-value agents must understand this ceiling and supplement it with a bonding pool if their agent's assets exceed it.

**Coverage ceiling formula:**

```
coverage_ceiling = K × operator_stake × max_slash_fraction / safety_margin

At baseline tier (50 ETH stake, 100% slash for equivocation, K=7, 2× safety):
coverage_ceiling = 7 × 50 × 100% / 2 = 175 ETH ≈ $525,000

At financial tier (100 ETH stake, K=7, 2× safety):
coverage_ceiling = 7 × 100 × 100% / 2 = 350 ETH ≈ $1,050,000
```

Agents with assets exceeding the coverage ceiling of their operator set's stake tier SHALL be documented as "uninsured beyond the ceiling." The supplemental bonding pool mechanism exists for these agents; it is optional but strongly recommended.

**This ceiling must be communicated to deployers in the CLI and documentation, not buried in a spec.**
