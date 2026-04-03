The Project Potential agent finished. Here's its report:

---

Project Potential Evaluation

1. Problem-Solution Fit

The problem is acute and worsening. AI agents signing transactions, committing code, and calling APIs at scale
need non-forgeable identities. Current approaches (EOA single-party keys, institutional MPC custodians) are
either single points of failure or single points of institutional trust.

Framing gap: The current framing ("prove a key hasn't been stolen") is a security-team problem. The stronger
framing is "make AI agent actions legally non-repudiable and auditable" — a compliance and product problem with
a much larger addressable surface. HashID should lean into use cases like:

- API providers rate-limiting by verifiable agent identity (not shareable API keys)
- Multi-sig wallets requiring threshold-verified agent identity before co-signing
- Enterprise compliance audit trails where every agent action carries a non-forgeable signature

The specs are currently silent on what verifiers DO with verification beyond "identity confirmed" — a
significant adoption gap.

---

1. Technical Differentiation

Genuine differentiation vs. alternatives:

┌────────────────┬───────────────────┬──────────────────┬────────────────┬─────────────────┐
│ Solution │ No Trusted Dealer │ Standard Ed25519 │ Permissionless │ On-chain Anchor │
├────────────────┼───────────────────┼──────────────────┼────────────────┼─────────────────┤
│ HashID │ ✅ FROST DKG │ ✅ │ ✅ │ ✅ │
├────────────────┼───────────────────┼──────────────────┼────────────────┼─────────────────┤
│ Lit Protocol │ ✅ │ ❌ BLS curve │ Partially │ Partially │
├────────────────┼───────────────────┼──────────────────┼────────────────┼─────────────────┤
│ Fireblocks MPC │ ❌ trusted dealer │ Varies │ ❌ │ ❌ │
├────────────────┼───────────────────┼──────────────────┼────────────────┼─────────────────┤
│ Raw EOA │ ❌ │ ❌ secp256k1 │ ✅ │ ✅ │
├────────────────┼───────────────────┼──────────────────┼────────────────┼─────────────────┤
│ ARPA Network │ ✅ │ ❌ BLS │ ✅ │ Partial │
└────────────────┴───────────────────┴──────────────────┴────────────────┴─────────────────┘

Key advantage: The FROST group key is indistinguishable from a single-party Ed25519 key — every existing
verifier works without modification. This is the critical adoption advantage Lit Protocol doesn't have (BLS
requires verifier changes).

V8 heap concern: FROST intermediate values (nonce scalars, partial sig scalars) live in V8's JIT heap and
cannot be zeroed before GC. The Rust signer subprocess path should be on the roadmap.

---

1. Open Source Strategy

Open sourcing is non-optional — operators won't deploy untrusted binaries holding FROST key shares, and
protocol credibility requires auditability.

Fork risk: If EigenLayer coupling is not behind an abstraction interface, a well-resourced fork that strips
EigenLayer and builds an alternative operator network captures the open protocol work. Recommended:
IOperatorNetwork interface from day one.

Positioning: HashID should be a protocol (on-chain interface + wire protocol = the standard) + reference
implementation (TypeScript CLI = the first implementation). The WebAuthn model: a standard no one "owns,"
platform vendors implement.

Likely contributors: EigenLayer ecosystem devs, AI agent framework maintainers (LangChain/CrewAI), wallet infra
teams (Safe, Gnosis).

---

1. Ecosystem Position

HashID sits at the agent identity layer between agent frameworks and EigenLayer/Ethereum:

AI Agent Frameworks (LangChain, AutoGPT, CrewAI)
↓
HashID (agent identity layer)
↓
EigenLayer AVS + EigenDA
↓
Ethereum

High-leverage integration targets: LangChain, Safe{AI}, EigenLayer AVS ecosystem, B2B API providers (Anthropic
API billing attribution by verified agent identity).

Adoption path:

1. Testnet AVS with 10+ operators
2. One major agent framework SDK integration (LangChain) — ship simultaneously, not sequentially
3. Audited mainnet contract deployment
4. ERC draft for AnchorIdentity interface
5. Operator fee model that makes economics viable

---

1. Risks and Blockers

Critical — Operator economics is unresolved and blocks mainnet. Without a session fee model, operators have no
liveness incentive. This must be designed alongside the contracts, not after.

High — No abstraction boundary on EigenLayer. Any EigenLayer economics change, protocol upgrade, or competitive
AVS creates a difficult migration. IOperatorNetwork interface needed now.

High — Developer ergonomics gap. Onboarding requires: funded Ethereum account, 10+ operators available, EigenDA
access, gas. A "HashID in a box" managed starter mode (team-operated permissioned operator set) would lower
the bar for the first 100 developers.

Medium — Governance undefined. Who upgrades the contracts? Who controls AVS slashing conditions? Immutable
contracts with succession-chain-based migration is likely the right answer for a key custody system, but this
needs to be decided before mainnet.

Medium — Regulatory surface. Agents signing financial transactions may pull the identity layer into AML/KYC
scope depending on jurisdiction. Guardian addresses with veto power may be analogous to regulated key escrow.
Legal review needed before financial services use cases.

---

1. Future Trajectory

- Near-term: Rust signer subprocess to eliminate V8 heap exposure. TEE (AMD SEV-SNP) for operators — eliminates
  the operator infra compromise vector entirely.
- Medium-term: Multi-chain operator abstraction. Agent-to-agent delegation (Agent A threshold-signs a scoped
  capability for Agent B).
- Long-term: ZK proofs of threshold signature possession for confidential verification.
- ERC/EIP: The spec quality is already at ERC-draft level. The AnchorIdentity interface warrants
  standardization — this is a 2-week effort that compounds for years.

Durability: The "AI agent identity" framing will evolve but the underlying need won't. As agents take more
consequential actions, the identity problem becomes more acute. The cryptographic primitives are sound and not
AI-specific.

---

Verdict

Top 3 strengths:

1. No trusted dealer + standard Ed25519 output → zero verifier changes required
2. EigenLayer bootstrap solves the operator cold-start problem on day one
3. Protocol-first spec quality is already at ERC-draft level — rare for pre-mainnet

Top 3 risks:

1. Operator economics unresolved → hard mainnet blocker
2. Developer ergonomics gap → needs a managed starter mode for early adopters
3. No IOperatorNetwork abstraction → fragile EigenLayer coupling

Recommended next steps:

1. Define session fee model as part of contract design, not after
2. Ship testnet + LangChain SDK integration simultaneously (neither alone is a product)
3. File ERC draft for AnchorIdentity — 2 weeks of effort, years of compounding legitimacy

---

Still waiting on the Logical Issues and Attack Vectors agents. Will surface their reports as they complete.

✻ Worked for 45s · 2 background tasks still running (↓ to manage)

⏺ Agent "Analyze HashID protocol logical issues" completed

⏺ The Logical Issues agent finished. Here's its report:

---

Logical Issues Analysis

🔴 Critical

Issue 6: Concentration Limit Formula Evaluates to Zero for All Realistic N

The operator concentration limit is floor((K-1)/N) where K = ceil(N×2/3). For any realistic N, this evaluates
to 0:

- N=10, K=7: floor(6/10) = 0
- N=20, K=14: floor(13/20) = 0
- N=50, K=34: floor(33/50) = 0

For all N where K ≈ 2N/3, the result is always 0. If implemented literally, DKGInit would revert for any
non-empty operator set — the protocol is completely non-functional. The intended formula is probably
floor((N-K)/N) (the fault tolerance fraction) or something else entirely.

---

🟠 High

Issue 1: Session Expiry Window Contradiction (30 min vs 5 min)

- on-chain-session/spec.md: session expires after 30 minutes
- verification-flow.md: "5-minute async signing window"
- threshold-signing/spec.md: signing request expires after 5 minutes

The 5-minute figure refers to per-signing-request expiry, not session expiry. But the verification flow doc
states the whole session window is 5 minutes, directly contradicting the on-chain spec. Verification-protocol
spec implies 30 minutes (recommends submitting all 5 requests in the first 25 minutes). No resolution rule
specified.

Issue 5: Resharing Race with In-Flight Signing Sessions

If an epoch advances (all N Phase 2 confirmations received) while a signing session is mid-flight (nonce
commitments from Round 1 sent with epoch-E shares, but Round 2 arrives after epoch-E+1 is established),
operators will compute partial sigs using epoch-E+1 shares against epoch-E nonce commitments. FROST requires
the same share in both rounds — the assembled signature will be invalid. No spec requirement to drain in-flight
sessions before signaling epoch completion.

Issue 7: All-N Resharing Confirmation Creates Permanent Liveness Deadlock

Resharing requires ALL N operators to confirm Phase 2. A single offline or deliberately non-confirming operator
blocks the ceremony indefinitely. Old shares remain valid forever in this case. No operator exclusion
mechanism, no slashing for failing to confirm Phase 2 (only for failing deletion attestation after completion,
which never triggers if completion never occurs). A single compromised operator can permanently block share
rotation — completely undermining ProactiveSS security.

Issue 9: Succession Commitment Griefing

The commit phase is not restricted to the agent — any party who can front-run can submit a commitment. With
1-hour rate limits between commits and 48-hour expiry, a griefing attacker can block succession indefinitely by
committing once per hour. The legitimate agent's control key is presumably compromised (that's why succession
is needed), so the cancellation path (requiring control key signature) may be unavailable.

Issue 12: Control Key Rotation Invalidates In-Flight Sessions

The state machine allows signing during CONTROL_KEY_ROTATION_PENDING. But when revealControlKeyRotation
confirms, the on-chain control_pubkey updates immediately. Auth tokens for in-flight sessions (signed with the
old control key) will now fail operator verification. OPEN sessions cannot be completed — they must be
abandoned. The spec implies signing is uninterrupted through rotation, which is incorrect.

Issue 14: Genesis Corpus Undefined in Current Active Specs

The verification flow references "challenge strings drawn from the agent's genesis corpus." The genesis corpus
spec exists only in the archived ML biometric change (deleted approach). The current active specs contain no
definition of what challenges a verifier should use. Verifiers have no defined source for challenges — a
fundamental interoperability gap.

Issue 15: EigenDA is a Hard Verification Dependency with No Fallback

Verification requires fetching the identity record from EigenDA to verify db_commitment. But the stable
identity core — sha256(agent_id || threshold_pubkey || control_pubkey) — is entirely recoverable from on-chain
data (group_pubkey, control_pubkey, db_commitment are all on-chain). EigenDA availability is not needed for
identity verification. Making it a hard dependency without fallback degrades a cryptographically-rooted
identity system to one that is only as available as EigenDA.

Issue 18: Succession Signature Payload Definition Inconsistent Across Docs

Three different specs describe the succession signature payload differently:

- key-management.md: old_key signs {new_pubkey, ts, reason}
- key-succession/spec.md: hash({ new_pubkey, timestamp }) — no reason, hash function unspecified
- security-hardening.md: keccak256(new_pubkey || timestamp || reason)

If the CLI uses sha256 but the on-chain contract verifies with keccak256, every succession ceremony fails at
reveal time. This is a protocol-breaking inconsistency that only manifests at the worst possible moment —
during key compromise recovery.

Issue 2: No Recovery Path After Partial DKG Abort

No spec defines cleanup for partial-completion DKG states (Round 1 complete but coordinator unreachable before
Round 2; Round 2 partially distributed). Operators retain orphaned share material. No timeout for orphaned
fragments, no binding between cleanup and slashing, no defined operator behavior.

Issue 3: db_commitment Lacks DKG Session Binding

db_commitment = threshold_sign(sha256(agent_id || threshold_pubkey || control_pubkey)) contains no reference to
the DKG session_id or operator set. A coordinator that retained partial shares from an aborted session could
potentially present a stale keypair with a valid db_commitment to a new agent. The commitment proves someone
with the threshold key endorsed the record, not that it was the operator set the agent negotiated with.

---

🟡 Medium

┌─────┬─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ # │ Issue │
├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 4 │ eigenda_record_id is null when written to EigenDA, making the field self-referential and │
│ │ tamper-detection semantics incoherent │
├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 8 │ Guardian term can expire during SUCCESSION_PENDING — contract may not check term validity at veto │
│ │ time │
├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 10 │ VRF seed = keccak256(session_id || blockhash(B-1)) reuses same blockhash as session_id — adds no │
│ │ entropy; operator selection is immediately observable after confirmation │
├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ Per-agent rate limit (60/hour) enforced independently by coordinator AND operators, but operators │
│ 11 │ only see VRF-sampled subset (~70% at N=10, K=7) — they cannot correctly enforce the limit │
│ │ independently │
├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 13 │ successor field in EigenDA record is "legitimately mutable" and excluded from db_commitment — │
│ │ unprotected against EigenDA record replacement │
├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 17 │ Resharing called "ProactiveSS" but spec requires a new DKG with new polynomials — which would │
│ │ produce a new group pubkey, requiring a succession entry, defeating the point │
└─────┴─────────────────────────────────────────────────────────────────────────────────────────────────────┘

---

Summary of Most Dangerous Issues

┌──────────┬────────────────────────────────────────┬──────────────────────────────────────────────────────┐
│ Priority │ Issue │ Why It Matters │
├──────────┼────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ P0 │ #6 Concentration formula = 0 │ DKG would always revert — protocol non-functional │
├──────────┼────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ P0 │ #18 Succession sig payload │ Every succession ceremony fails at reveal │
│ │ inconsistent │ │
├──────────┼────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ P0 │ #14 Genesis corpus undefined │ Verifiers have no defined challenge source │
├──────────┼────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ P1 │ #7 All-N resharing deadlock │ Single operator blocks share rotation permanently │
├──────────┼────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ P1 │ #1 Session window contradiction │ Operators and verifiers operate on different │
│ │ │ timeouts │
├──────────┼────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ P1 │ #5 Resharing race │ In-flight sessions silently fail across epoch │
│ │ │ boundary │
└──────────┴────────────────────────────────────────┴──────────────────────────────────────────────────────┘

---

Still waiting on the Attack Vectors agent.

✻ Baked for 51s

⏺ Agent "Find uncovered HashID attack vectors" completed

⏺ All 3 agents are done. Here's the Attack Vectors report:

---

Uncovered Attack Vectors

🔴 Critical

T-037: Guardian Key Theft → Permanent Succession Veto

A stolen guardian key lets the attacker rotate the guardian to themselves (commit-reveal + 24h timelock). Once
registered as guardian, they veto every future succession attempt indefinitely. No guardian-of-guardian, no
emergency bypass, no recovery path exists. The only counter is winning a race against the 24h window —
operationally unreliable. Fix: Require K-of-N threshold-sign endorsement for guardian rotation, not just the
commit-reveal flow.

T-038: Coordinator SPOF — No Failover Protocol Defined

T-022 in the existing threat model names this but leaves it completely unmitigated. A DDoS on the single
coordinator denies signing to ALL agents simultaneously — much higher ROI than attacking individual operators.
If coordinator goes down during resharing Phase 2, operators cannot receive the completion signal; if down
during an active session, partial sigs have no delivery path. No coordinator registry, no handoff semantics, no
session recovery mechanism is specified anywhere. Fix: On-chain coordinator registry; sessions declare
coordinator address at initSession; secondary coordinators reconstruct state from on-chain Merkle roots.

T-039: Resharing to Attacker-Controlled Operator Set

FROST resharing doesn't change the public key — which is exactly what makes it dangerous if abused. A
compromised coordinator or agent machine (control key stolen) can initiate resharing to an entirely
attacker-controlled operator set. After completion, the attacker holds all N shares under the SAME
threshold_pubkey. No verifier notices — the public key is unchanged. The concentration limit applies at DKG but
the spec never specifies who can AUTHORIZE resharing or that the limit is enforced at resharing time. Fix:
Resharing initiation must require K-of-N threshold-sig from the CURRENT operator set endorsing the new operator
composition.

---

🟠 High

T-032: Stolen Control Key Enables Rate-Limit Exhaustion DoS

A stolen control key can't forge threshold signatures (still needs K operators), but can generate unlimited
valid auth_token values. Attacker submits 60 valid requests/hour against any open session, exhausting the rate
limit for the legitimate agent indefinitely. No mechanism to signal key compromise to coordinator, no emergency
rate-limit override, no way to distinguish legitimate vs. attacker requests in operator logs. Fix: On-chain
emergency suspend callable by guardian; rate-limit window reset when revealControlKeyRotation confirms.

T-033: Operator Selective Non-Participation — Undetectable Liveness Attack

A coalition of N - K + 1 operators (just 4 at N=10) can block any specific agent indefinitely by simply not
responding when sampled. No partial signature = no nonce commitment = no rejection receipt = no on-chain
evidence = no slashing. They rotate which 4 are "offline" per session. Pure liveness failure, undetectable
on-chain. Combined with T-034 (sampling is deterministic), operators can pre-compute when they'll be sampled
and selectively go offline. Fix: Coordinator logs signed non-participation attestations;
slashLiveness(operator_id, session_ids[], proofs[]) after 3+ consecutive non-responses.

T-035: Nonce Log Completeness Is Unverifiable

Merkle trees prove inclusion, not completeness. A coordinator that excludes rejection receipts from the Merkle
root makes message-substitution events invisible on-chain. Operators A, B, C who emitted rejection receipts
can't prove they were excluded — they can only refuse the next round (a liveness action, not a fraud proof).
The slashCoordinator requires ceil(K/2) rejection receipts in the log, but if receipts are excluded from the
root, the slash never triggers. Fix: Operators broadcast rejection receipts to a bulletin board (on-chain or
p2p); Merkle root must cover all bulletin-board entries, making exclusion detectable by any third party.

T-036: Verifier Session Monopolization Locks Per-Agent Capacity

With N=10, the per-agent cap is N×2 = 20 concurrent sessions. Just 2 colluding registered verifiers (each
opening 10 sessions) fully saturate the target agent's capacity. All other legitimate verifiers get
agent-session-limit-exceeded. Verifiers hold sessions open for 30 minutes, let them expire, reopen — the bond
is not burned on expiry (session expiry is not misbehavior per the spec). Sustainable indefinitely with 2
bonds. Fix: Per-(verifier, agent) sub-limit; slash condition for repeated session abandonment against the same
agent.

T-041: EigenDA Write Authorization Undefined — Fake Record Injection

Listed as an open question in design.md: "Is EigenDA open-write or gated by the AVS contract?" If open-write,
any party can upload a fake identity record and receive a legitimate eigenda_record_id. The db_commitment still
protects the core fields, but the successor field (explicitly excluded from db_commitment as "legitimately
mutable") is unprotected. An attacker could overwrite the EigenDA record's successor field to point to a
fraudulent succession entry, causing verifiers that trust EigenDA-served data to follow a false chain. Fix: AVS
contract authorization for EigenDA writes; verifiers must read eigenda_record_id directly from on-chain RPC,
never from cache.

T-045: Economic Model Entirely Unspecified

The entire deterrence model is based on slashing, but no spec defines any slash amount. Without numbers:

- No claim about "slashing prevents collusion" is defensible
- No operator has positive liveness incentive (fee model undefined)
- slashNonceReuse has no reporter reward — who pays gas to submit Merkle proofs?
- Coordinator bond is undefined — a 1 ETH bond doesn't deter a 10 ETH-profit disruption

Fix: Define minimum slash amounts as protocol parameters calibrated against maximum estimated forged-identity
value. Reporter reward = fraction of slashed amount. Per-signing-request fee to operators from verifier bond.

---

🟡 Medium

┌───────┬───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ID │ Attack │
├───────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ T-034 │ VRF sampling is a deterministic PRF, not an actual VRF — operators can pre-compute which sessions │
│ │ they'll be sampled for and go offline selectively │
├───────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ T-040 │ Block reorg changes blockhash(B-1) → different session_id → operators who already generated nonce │
│ │ material for the original session have "used" nonces for a session that no longer exists │
├───────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ Succession commit monopolization: a stolen control key can repeatedly submit commits (48h expiry, │
│ T-042 │ 1h between commits) without ever completing succession — blocking the legitimate agent's ability │
│ │ to commit │
├───────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ spendSession signature count enforcement unspecified — does the contract verify all 5 signatures │
│ T-043 │ on-chain or trust the verifier's submission? If the latter, a malicious verifier can declare an │
│ │ agent "verified" after 1 valid sig │
└───────┴───────────────────────────────────────────────────────────────────────────────────────────────────┘

---

Top 5 Priorities (Not Already in Threat Model)

┌──────────┬──────────────────────────────────┬────────────────────────────────────────────────────────────┐
│ Priority │ Vector │ Why │
├──────────┼──────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ P0 │ T-039 Resharing to attacker │ Silently migrates key to attacker under same pubkey; no │
│ │ operator set │ verifier detects it │
├──────────┼──────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ P0 │ T-037 Guardian key → permanent │ No recovery path; single key theft locks identity │
│ │ succession veto │ permanently │
├──────────┼──────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ P0 │ T-038 Coordinator SPOF │ Affects ALL agents simultaneously; named in T-022 but left │
│ │ unmitigated │ completely unresolved │
├──────────┼──────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ P1 │ T-045 Economic model undefined │ No slash amount = no deterrence claim is defensible │
├──────────┼──────────────────────────────────┼────────────────────────────────────────────────────────────┤
│ P1 │ T-035 Nonce log completeness │ Coordinator can hide message-substitution events from the │
│ │ unverifiable │ accountability mechanism │
└──────────┴──────────────────────────────────┴────────────────────────────────────────────────────────────┘

---

Cross-Report Summary

Here's a consolidated view of the most critical findings across all 3 agents:

Spec-breaking bugs (would make the protocol non-functional):

- Concentration limit formula floor((K-1)/N) = 0 for all realistic N → DKG always reverts
- Session window contradiction (5 min vs 30 min) → operator/verifier timeout mismatch
- Succession signature payload inconsistency across docs → every succession reveal fails
- Genesis corpus undefined → verifiers have no defined challenge source

Architecture-breaking gaps (protocol works but safety guarantees are void):

- T-039: Resharing to attacker-controlled operator set — single biggest unaddressed threat
- T-037: Guardian key = permanent succession veto with no recovery
- T-038: Coordinator SPOF completely unmitigated
- All-N resharing confirmation → single operator blocks share rotation forever

Economic/viability blockers:

- Operator fee model undefined → no liveness incentive
- Slash amounts undefined → no deterrence claim holds
- Developer onboarding gap → no managed starter path
