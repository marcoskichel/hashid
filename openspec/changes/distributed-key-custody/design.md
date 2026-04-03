## Context

The LoRA behavioral fingerprint approach (agent-biometrics, genesis-shard-network changes) was validated as non-viable across five spike iterations. Mean similarity between authentic and different-model outputs converged to ~0.49 (random) regardless of training strategy. The fundamental issue: transformer models cannot generalize cryptographic functions to unseen inputs, so any model-output biometric either fails on held-out challenges or produces identical outputs across different model seeds.

The design pivots to standard Ed25519 threshold signing using FROST (RFC 9591). The agent holds a signing key, but the key is never reconstructed in a single location — it is distributed across a network of independent staked operators using Shamir-based distributed key generation. No single operator can forge a signature.

Current state: `packages/hashid-cli` exists as a Python package containing ML training scripts (deleted in this change) and placeholder command stubs. The entire package is converted to TypeScript in this change, aligning with the monorepo's primary stack.

## Goals / Non-Goals

**Goals:**
- Distributed private key: no single party ever holds the reconstructed Ed25519 private key
- Threshold signing: K-of-N operators must co-sign; collusion requires compromising a supermajority
- Bootstrap-problem solved: use an existing staked network (EigenLayer AVS) as genesis validators — no operator recruitment
- Replay-safe: on-chain session nonces prevent signature reuse
- Tamper-evident storage: EigenDA with on-chain commitment; tampering is detectable
- Key rotation without identity change: FROST resharing rotates shares without changing the public key
- Full keypair rotation: succession chain links old and new keypairs via signature
- TypeScript-native CLI: `packages/hashid-cli` rebuilt as a Node.js/TypeScript package

**Non-Goals:**
- TEE-based signing (may augment later for high-stakes scenarios)
- Multi-chain support (EigenLayer on Ethereum mainnet only initially)
- Anonymous verification (verifier must be a registered on-chain entity)
- Confidential challenge content (challenges are public; only signatures are secret)

## Decisions

### Decision 1: FROST(Ed25519) over BLS threshold or Shamir with trusted dealer

**Choice:** FROST(Ed25519) per RFC 9591.

**Alternatives considered:**
- *BLS threshold*: Natural aggregation, but BLS uses a different curve (BN254/BLS12-381). Agent identity keys are Ed25519 (existing standard, tooling ecosystem). Switching curves requires downstream verifier changes with no benefit beyond aggregation ergonomics.
- *Shamir with trusted dealer*: Simple, but the dealer sees the full key at generation time — eliminates distributed trust guarantee at the critical bootstrap moment.
- *Pedersen DKG (raw)*: FROST DKG is Pedersen DKG with a broadcast-and-verify round; FROST packages this correctly per RFC 9591. Using raw Pedersen adds implementation surface without benefit.

**Why FROST:** No trusted dealer (DKG is fully distributed), produces a standard Ed25519 keypair (public key is indistinguishable from a single-party key), RFC-specified nonce generation prevents per-share key recovery attacks, and `@noble/curves` provides a pure TypeScript implementation with no WASM or native bindings.

**PoK enforcement model:** RFC 9591 / FROST paper Figure 1 requires each DKG participant to produce a Schnorr proof-of-knowledge `σ_i = (R_i, μ_i)` over their constant-term commitment `φ_{i0}`. This prevents the rogue key attack (a malicious operator biasing the group public key to one they control). Each operator MUST verify all peers' PoK independently before proceeding to Round 2 — this is the primary, load-bearing control. The coordinator SHOULD also verify before relaying as defence-in-depth against equivocation, but coordinator verification does not substitute for per-operator verification.

### Decision 2: `packages/hashid-cli` converted to TypeScript

**Choice:** Rebuild `hashid-cli` as a Node.js/TypeScript package using the monorepo's standard stack.

**Alternatives considered:**
- *Keep Python for CLI, add TS bridge*: The only reason for Python was the ML training scripts, which are deleted in this change. Maintaining a Python package in a TypeScript monorepo adds toolchain complexity with no benefit.
- *Rust CLI*: Better performance for cryptographic operations, but adds a third language. `@noble/curves` benchmarks are fast enough for interactive CLI use.

**Why TypeScript:** All new dependencies (`@noble/curves`, EigenLayer AVS SDK, EigenDA client) have first-class TypeScript bindings. Aligns with monorepo conventions (turbo, pnpm, vitest). Eliminates the Python toolchain from the repo entirely.

### Decision 3: EigenLayer AVS as the operator network

**Choice:** Deploy a custom EigenLayer AVS; use EigenLayer restakers as genesis operators.

**Alternatives considered:**
- *Custom validator network*: Requires recruiting, funding, and monitoring independent operators from scratch. Bootstrap problem: no operators at genesis.
- *Lit Protocol*: Closest existing solution (staked threshold signing nodes). But: FROST/Ed25519 is roadmap-only (currently BLS), no native storage layer, general programmable KMS — not identity-anchored.
- *MPC wallets (Fireblocks, Forta)*: Enterprise custody products, not permissionless, incompatible with autonomous agent signing.

**Why EigenLayer AVS:** $8B+ in restaked ETH available day one — no bootstrap recruitment needed. AVS operators are economically slashed for misbehavior. Same operator set is used by EigenDA, reducing integration surface. ARPA Network is a production reference for BLS-TSS on EigenLayer.

### Decision 4: K = ceil(N × 2/3) threshold

**Choice:** Require supermajority (2/3 + 1) of operators to produce a valid signature.

**Why:** BFT-standard threshold. Prevents a 33%-collusion minority from blocking liveness while requiring a 66%+ supermajority for forgery — larger than any realistic cartel. EigenLayer slashing further reduces collusion incentive.

### Decision 5: Per-session VRF operator sampling

**Choice:** For each signing session, sample a fresh random subset of K operators using an on-chain VRF.

**Why:** If the same K operators co-sign every session, a persistent attacker can target exactly those K operators. Random per-session sampling means the attacker must compromise a supermajority of the full operator set simultaneously — not just a fixed K-member committee.

### Decision 6: On-chain session anchoring before signing

**Choice:** Verifier calls `initSession(agent_pubkey, nonce, verifier_pubkey)` on-chain before sending challenges. Operators refuse to co-sign any request not tied to a registered, unspent session.

**Why:** Without this, any party can present challenges and collect partial signatures. The on-chain session is the authorization gate: operators verify `(agent_pubkey, session_id)` exists and is unspent before contributing a partial signature. Session nonces are single-use — spent atomically on successful signing.

### Decision 7: EigenDA for identity record storage

**Choice:** Publish identity records to EigenDA; anchor the content hash on-chain via `AnchorIdentity(pubkey, eigenda_record_id, db_commitment)`.

**Alternatives considered:**
- *IPFS*: Content-addressed but no durability guarantees. No on-chain proof of write.
- *Local storage*: Not suitable for a distributed verification model.
- *Arweave/Filecoin*: Different operator sets — splits trust model.

**Why EigenDA:** Uses the same EigenLayer operator set as the signing AVS — same trust assumptions, no second operator relationship. On-chain `db_commitment` makes tampering detectable without re-downloading the full record.

### Decision 8: FROST resharing for share rotation, succession chain for full keypair rotation

**Choice:** Suspected share compromise → FROST resharing (ProactiveSS, no pubkey change). Confirmed key compromise → succession chain (old key signs new pubkey before destruction).

**Why two tiers:** FROST resharing handles the common case with zero verifier impact (same public key). Full succession chain is reserved for confirmed compromise — it requires downstream verifiers to walk the chain and adds on-chain state. Keeping the default path (resharing) cheap avoids unnecessary ceremony overhead.

### Decision 9: Async 5-minute signing window

**Choice:** Agents submit a signing request and poll for the assembled signature within a 5-minute window. Operators process requests asynchronously.

**Why:** Synchronous K-of-N coordination requires all K operators to be online simultaneously. With a 5-minute async window, operators contribute partial signatures independently, and the agent assembles the final signature once K shares arrive. If fewer than K shares arrive within 5 minutes, the request expires and the agent retries with a new sampled operator set.

## Risks / Trade-offs

**EigenLayer operator liveness** → If fewer than K operators respond within 5 minutes, signing fails. Mitigation: retry with a different random sample; liveness improves as operator count grows.

**EigenDA availability** → Identity records unavailable if EigenDA is down. Mitigation: on-chain commitment allows verifiers to detect stale/absent data; operator slashing creates availability incentives.

**FROST nonce security** → Reusing a nonce across two signing requests allows key recovery from two partial signatures. Mitigation: RFC 9591 mandates random per-request nonces; operators MUST generate fresh nonces from a CSPRNG per signing round. Nonce reuse is a slashable condition.

**EigenLayer AVS deployment complexity** → Custom AVS with slashing conditions requires on-chain contract development and audit. Mitigation: initial AVS scopes to minimal slashing (equivocation only); expanded conditions added post-audit.

**Operator collusion at small N** → With N=10, K=7; compromising 7 operators is more feasible than at N=100. Mitigation: launch with EigenLayer's full active operator set; VRF sampling spreads sessions randomly.

**Succession chain walk latency** → Verifiers must walk the full chain to find the current key. Mitigation: chain is short (rotation is rare); verifiers cache the current key with TTL and re-walk on cache miss.

## Migration Plan

1. **Convert `packages/hashid-cli` to TypeScript**: Delete Python scripts; scaffold Node.js/TypeScript package with pnpm; add `@noble/curves`, EigenLayer AVS SDK, EigenDA client.
2. **Deploy AVS contracts**: EigenLayer AVS contract with operator registration, slashing conditions, session management — testnet first, audited before mainnet.
3. **Deploy identity contracts**: `AnchorIdentity` and `SessionRegistry` — no migration of existing keys (none exist in production).
4. **Rewrite `hashid bootstrap`**: FROST DKG ceremony → identity record → EigenDA write → `AnchorIdentity` call.
5. **Rewrite `hashid verify`**: `initSession` on-chain → challenges → receive Ed25519 signature → verify against on-chain pubkey.
6. **Rollback**: If AVS misbehaves, identity contract can be paused; EigenDA records remain readable; re-bootstrap with a new operator set.

### Decision 10: Commit-reveal + 24-hour timelock for keypair succession

**Choice:** Succession uses a two-phase commit-reveal with a mandatory 24-hour delay between commit and reveal.

**Why:** Direct succession submission exposes `new_pubkey` in the mempool. An attacker with K shares can observe the mempool, extract `new_pubkey`, and race to file a fraudulent succession entry. Commit-reveal severs this: the commit phase stores only `keccak256(agent_id || old_pubkey || new_pubkey || salt)` — the pubkey is not extractable without the salt. The 24-hour delay is the detection window for T-018 (succession chain injection), not a frontrunning countermeasure (commit-reveal already eliminates frontrunning). Only the committing address can reveal, preventing any third party from completing a commitment they observed.

### Decision 11: Operator accountability via signed nonce commitments

**Choice:** Operators sign their nonce commitments with their AVS Ed25519 key and send them directly to the agent. The agent archives signed commitment sets to EigenDA after each Round 1 (best-effort; signing is not blocked if archival fails). Nonce reuse is proved on-chain by submitting two signed commitments with identical `(D_i, E_i)` to `slashNonceReuse` — no Merkle proofs or per-session on-chain writes required.

**Why:** The coordinator-centric Merkle root publication model required on-chain writes after every signing round and complex inclusion-proof flows for operators. The lazy archival model only touches the chain when fraud actually occurs. Operators are accountable for their own commitments directly — no trusted intermediate party needed. Two valid operator-signed commitments with the same nonce are conclusive, self-contained evidence regardless of any log. EigenDA write authorization is permissionless; the `db_commitment` FROST threshold signature is the sole authorization gate — a crafted record without a valid threshold signature cannot anchor a valid identity.

### Decision 12: Agent control key as mandatory signing gate

**Choice:** The agent generates a single-party Ed25519 "control key" at bootstrap. The control public key is registered on-chain in `AnchorIdentity` alongside the FROST group key. Every signing request MUST include an auth token `sign(session_id || message_hash, control_privkey)` produced by the agent. Operators reject any signing request without a valid auth token verifiable against the on-chain control public key.

**Why:** K colluding operators — together with a fake registered verifier they control — can produce valid group signatures without the agent's involvement. Economic deterrence (EigenLayer slashing) is insufficient when the value of a forged identity is unknown and potentially unbounded. The control key creates a two-factor structure:

- **Factor 1**: agent's control private key (held only on agent machine)
- **Factor 2**: K-of-N FROST share cooperation (held only by operators)

Neither factor alone is sufficient. Stealing the control key gives the ability to authorize requests but still requires K operators. Compromising K operator shares gives partial signatures but no valid auth token. This is cryptographic impossibility, not economic deterrence.

**What does not change:** The FROST group key remains the sole public identity key. Verifiers continue to call `ed25519.verify(sig, message, group_pubkey)`. The control key is an operator-side gate, invisible to external verifiers.

**Trade-offs:**
- Agent must be online for every signing request to produce auth tokens (acceptable — the agent is the signing coordinator and is online by design).
- Control key is a single-party key on the agent machine. If compromised it does not enable forgery alone, but does allow an attacker to initiate signing requests contingent on operator cooperation.
- Control key rotation is bundled with group key succession — both rotate atomically in the same commit-reveal ceremony.

### Decision 13: Coordinatorless, agent-driven signing

**Choice:** Remove the AVS Coordinator as a separate infrastructure component. The agent drives the full signing flow: it reads operator endpoints from an on-chain registry, computes VRF sampling deterministically from on-chain data (`keccak256(session_id || block.prevrandao)`), contacts operators directly for both DKG and threshold signing, and performs FROST aggregation itself.

**Alternatives considered:**
- *Keep coordinator as a convenience layer*: Reduces agent complexity but reintroduces T-038 (coordinator SPOF affecting all agents simultaneously), coordinator trust assumptions, coordinator bond/slashing complexity, and a coordinator-specific attack surface.

**Why coordinatorless:** The coordinator was doing nothing that the agent cannot do with public on-chain data and direct operator communication. Removing it eliminates the single point of failure that affected all agents simultaneously, removes an entire trust assumption from the protocol, and simplifies accountability (operators sign their own evidence rather than relying on a coordinator to publish it).

**Trade-offs:**
- Agent must manage direct operator communication (more complex client)
- Operators need publicly accessible endpoints (solved by on-chain registry)
- No coordinator anonymization layer between agent IP and operators (acceptable — the agent is authorizing signing and its participation is not secret)

### Decision 14: `block.prevrandao` as VRF seed input

**Choice:** `initSession` stores `block.prevrandao` from the inclusion block as `session.vrf_randao`. The VRF seed is `keccak256(session_id || session.vrf_randao)`. `block.prevrandao` replaces the previously considered `blockhash(B-1)` approach.

**Why:** `blockhash(B-1)` is available in Solidity but is controlled by block builders, who could mine for a favourable value. `block.prevrandao` is the beacon chain RANDAO value, contributed by the block proposer and mixed with accumulated randomness — it is not grindable by the verifier submitting the transaction. Storing `vrf_randao` in the session record makes the VRF seed independently recomputable by any party from on-chain data, which is required for `slashNonAcknowledgment` to verify VRF membership without off-chain proofs.

### Decision 15: Session acknowledgment as mandatory liveness signal

**Choice:** VRF-selected operators MUST submit `acknowledgeSession(session_id, operator_id, sig)` on-chain within 2 minutes of session creation. Failure to acknowledge is slashable via `slashNonAcknowledgment`.

**Why:** The signing window is 30 minutes, but the verifier needs to know early whether enough operators are ready before committing challenges. The 2-minute acknowledgment window gives the agent a fast readiness signal: if fewer than K acknowledgments arrive, the agent can let the session expire and open a new one, rather than waiting the full 30 minutes to discover operator unavailability. Slashing non-acknowledgment creates economic pressure for operators to monitor on-chain events and respond promptly.

### Decision 16: `initiateSuccessionWithEndorsement` as stolen-control-key recovery path

**Choice:** When the agent's control key is compromised and an attacker is spamming `commitSuccession` at the rate limit, the agent can bypass `commitSuccession` entirely via `initiateSuccessionWithEndorsement` — submitting a K-of-N FROST threshold signature that supersedes any pending commitment and resets the rate limit. The standard 24-hour timelock and guardian veto still apply.

**Why:** The rate limit (1-hour minimum between commits) that prevents succession spam also temporarily blocks the legitimate agent from filing their own commitment after an attacker fires first. The threshold-endorsed path provides a mechanism that cannot be blocked by a stolen control key: it requires K-of-N operator cooperation, which the attacker does not have. The 24-hour timelock is preserved because it is the guardian's detection window.

### Decision 17: `spendSession` enforces exactly 5 Ed25519 signatures

**Choice:** `spendSession(session_id, signatures[5])` verifies all 5 signatures on-chain before marking the session SPENT. The contract reverts if any signature is missing or fails verification. The session remains OPEN until all 5 signatures are valid.

**Why:** Partial session spending would allow a verifier to mark a session spent on fewer than 5 valid signatures, circumventing the full verification requirement. Requiring all 5 on-chain closes the race condition where an attacker could interleave a partial spend with a legitimate completion. The atomic all-or-nothing check is simpler to reason about and leaves no partial-state edge cases.

## Open Questions

- **AVS contract audit scope**: Which slashing conditions in the initial audit? Minimal (equivocation only) vs. expanded (nonce reuse, unauthorized signing)?
- **Operator count at genesis**: Need N ≥ 10 for meaningful security; operator incentive mechanism (AVS fee sharing) TBD.
- **Economic model**: Slash amounts, signing fees, and operator reward distribution are deferred to a separate change (T-045).
