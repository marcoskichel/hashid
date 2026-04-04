## MODIFIED Requirements

### Requirement: Session fee collection at initSession

A verifier SHALL deposit ETH equal to or exceeding the protocol-configured minimum session fee when calling `initSession`. The deposited ETH is held in escrow by `SessionRegistry` and is non-refundable except as defined in the fee release and abandonment requirements below. `initSession` SHALL revert if the attached ETH value is below the minimum session fee.

The minimum session fee is a protocol parameter set at deployment: **$8–$12 on L2 post-ZK** (expressed as an ETH amount at the oracle-reported price at `initSession` time, or as a fixed ETH floor — see implementation notes). During the pre-ZK transitional period, the minimum is **$30–$40** to cover unoptimized `spendSession` gas costs. The active minimum is stored in a contract constant that requires a new deployment to change.

Additionally, `initSession` SHALL verify the verifier's bonded balance against the target agent's declared `minVerifierBond`. If `SessionRegistry.bondBalance[msg.sender] < AnchorIdentity.minVerifierBond[agent_pubkey]`, the call SHALL revert with an insufficient-bond error.

#### Scenario: Session fee below minimum causes revert
- **WHEN** a verifier calls `initSession` with ETH value below the minimum session fee
- **THEN** the contract reverts with an insufficient-fee error; no session state is written; the ETH is returned

#### Scenario: Verifier bond below agent-declared minimum causes revert
- **WHEN** a verifier's bonded balance is below the agent's declared `minVerifierBond`
- **THEN** `initSession` reverts with an insufficient-bond error before writing any session state

### Requirement: Session fee release on spendSession

On successful `spendSession` (all 5 Ed25519 signatures verified), the escrowed session fee SHALL be distributed in the following order:

1. **EigenLayer protocol fee** (10%): transferred to the EigenLayer `RewardCoordinator` integration address
2. **Protocol treasury** (20%): credited to the treasury address
3. **Operator pool** (70%): credited equally among the K operators who submitted valid `acknowledgeSession` within the 2-minute window for this session

Operator credits accumulate in `SessionRegistry.operatorClaimable[operator_id]`. Operators withdraw their accumulated balance by calling `claimOperatorBalance()` — a pull-payment pattern. No per-session ETH transfer to operators is performed; all distributions are credit updates.

Weekly reward root submission to EigenLayer `RewardCoordinator` is performed by the protocol operator role (a trusted automated process), not per-session.

#### Scenario: Fee distributed on spendSession success
- **WHEN** `spendSession` is called with 5 valid signatures
- **THEN** the escrowed fee is split 10/20/70% among EigenLayer, treasury, and the K acknowledging operators; each operator's claimable balance increases by `(fee × 70%) / K`

#### Scenario: Operator claims accumulated balance
- **WHEN** an operator calls `claimOperatorBalance()`
- **THEN** the contract transfers `operatorClaimable[operator_id]` ETH to the operator's address; the claimable balance resets to zero

### Requirement: Session fee burn on expiry

When a session expires with `status: OPEN` (not spent), the escrowed fee SHALL be distributed as follows:

- **50% burned**: transferred to `address(0)`
- **50% distributed equally** to operators who submitted valid `acknowledgeSession` for the session within the 2-minute window

Operators are compensated for the acknowledgment work they performed even when the verifier abandons the session. The verifier receives nothing from an expired session's fee. This makes session spam economically costly for the verifier even if `slashSessionAbandonment` is not triggered.

If no operator submitted `acknowledgeSession` for the session (no acknowledgments within the window), the full fee is burned.

#### Scenario: Expired session fee is partially burned and partially distributed
- **WHEN** a session expires with 5 operators having submitted valid `acknowledgeSession`
- **THEN** 50% of the fee is burned; 50% is credited equally to those 5 operators (10% each)

#### Scenario: Expired session with no acknowledgments burns entire fee
- **WHEN** a session expires with zero valid acknowledgments
- **THEN** 100% of the escrowed fee is burned; no operator or treasury credit

### Requirement: slashSessionAbandonment fee and watcher reward

`slashSessionAbandonment` SHALL slash **50% of the verifier's bonded balance** (up to the bond balance; not a fixed ETH amount). The slash proceeds are distributed per the slash proceeds distribution requirement in `protocol-economics/spec.md`:

- 20% to the address that called `slashSessionAbandonment` (watcher reward)
- 30% to the protocol treasury
- 50% burned

The watcher reward SHALL be transferred atomically in the same transaction as the slash. The contract SHALL emit `SlashDistributed(verifier, watcher, watcherAmount, treasury, treasuryAmount, burned)`.

#### Scenario: Watcher earns reward on successful abandonment slash
- **WHEN** `slashSessionAbandonment` is called with valid 3-session evidence and the verifier has a 1 ETH bond
- **THEN** 0.5 ETH is slashed (50% of bond); 0.1 ETH to watcher, 0.15 ETH to treasury, 0.25 ETH burned; verifier retains 0.5 ETH bond balance
