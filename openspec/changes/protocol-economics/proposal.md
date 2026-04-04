# Proposal: Protocol Economics

## Problem

The protocol has no economic specification. Slash amounts, operator stake requirements, fee structures, verifier bond tiers, and fee distribution logic are all either absent or left to implementation discretion. This creates three concrete problems:

1. **Security model is unverifiable.** The threat model (T-001/T-008/T-012) documents attacks and calls for economic deterrence, but without calibrated slash amounts the deterrence claims cannot be evaluated. An operator could serve with 1 ETH stake and face a 0.001 ETH slash — trivially circumvented.

2. **Operator economics are unmodeled.** There is no analysis of whether running a HashID AVS node is financially viable. Without this, operators may join, discover the economics are negative, and quietly exit — producing a liveness failure with no slashable evidence.

3. **Three protocol gaps with economic consequences are unaddressed:**
   - Collusion / off-session co-signing is not a named slashable condition
   - Minimum participation rate for fee eligibility is unspecified (free-riding is possible)
   - Maximum coverable agent value is undocumented, leaving agents with a false security guarantee

## What Changes

**New capability: `protocol-economics`** — canonical specification of all economic parameters:
- Operator stake tiers (baseline, financial agents, high-value protocol agents)
- Slash calibration table with attacker-gain-based derivation for all slashable conditions
- Fee structure: bootstrap DKG fee, signing session fee, resharing fee, succession fee
- Fee distribution model: 70% operators / 20% treasury / 10% EigenLayer
- Verifier bond tiers (tiered by agent-declared value)
- Watcher incentive: 20% of slash proceeds to fraud-proof submitters
- Minimum N=10 requirement for production deployments
- Maximum coverable agent value documentation
- Token vs. ETH-native decision: ETH-native at launch

**Modified: `on-chain-session`** — fee collection and distribution mechanics:
- Session fee escrowed at `initSession`, released at `spendSession`
- Partial fee burn on session abandonment (50% burned / 50% to acknowledging operators)
- Verifier bond tiering: agent-declared minimum bond stored in AnchorIdentity record

**Modified: `coordinator-accountability`** — operator-level economic requirements:
- Minimum stake requirements per operator tier
- Slash amounts for all slashable conditions (compile-time constants)
- Minimum participation rate (≥95% of VRF-assigned sessions) for fee eligibility
- New slashable condition: `slashEquivocation` for off-session co-signing
- Slash proceeds distribution: 50% burned / 30% treasury / 20% fraud-proof submitter

## Prerequisites

This proposal assumes:

1. **ZK-optimized `spendSession`** — replacing 5 on-chain Ed25519 verifications (~2.5M gas = $156) with a Groth16 batch Ed25519 verifier contract (~250k gas = $15). Without this, operator share of session fees ($2.20) is consumed entirely by gas ($1.89 per `acknowledgeSession` at mainnet). The session fee structure in this proposal assumes post-ZK economics. ZK optimization should be tracked as a separate engineering change.

2. **L2 deployment** — deploying all contracts on Base or Arbitrum One reduces calldata costs 10–100× and makes per-operation gas manageable. All gas estimates in this proposal assume L2 pricing unless stated otherwise.

## Why Now

The security hardening spec (H-1 through H-6) and the threat-model-gap-resolution change close protocol-level security gaps. The economic layer is now the binding constraint: the protocol's resistance to attack is only as strong as the financial deterrence it creates. Without calibrated slash amounts and a viable operator business model, the security properties described in the threat model are aspirational, not guaranteed.
