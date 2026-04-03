# Security Hardening: Unified Solution

This document synthesizes the five parallel research threads into a unified hardening plan for HashID. Each section maps to one or more critical/high threats from the threat model, presents the research findings, and specifies the exact changes required.

---

## Overview

Five threats require structural changes before mainnet:

| # | Threat(s) | Area | Severity |
|---|---|---|---|
| H-1 | T-001, T-004 | FROST nonce reuse → key recovery | Critical |
| H-2 | T-002, T-003 | Missing DKG proof-of-knowledge → rogue key | Critical |
| H-3 | T-013, T-007 | Agent-machine compromise → sign arbitrary messages | High |
| H-4 | T-026, T-018 | Succession frontrunning + injection | High |
| H-5 | T-029–031 | Supply chain + operator memory | Critical |

These are not independent optimizations — they form a layered security model:

```
Supply chain (H-5) protects the cryptographic primitives
   ↓
DKG PoK (H-2) ensures the group key is honest from genesis
   ↓
Nonce safety (H-1) ensures each signing operation is one-way
   ↓
Challenge binding (H-3) ensures a compromised agent machine cannot redirect what is signed
   ↓
Succession protection (H-4) ensures key rotation cannot be hijacked
```

If any layer fails, downstream layers cannot compensate.

---

## H-1: FROST Nonce Safety

**Threats addressed:** T-001 (nonce reuse → key recovery), T-004 (partial signature accumulation)

### Problem

The `threshold-signing` spec says nonce reuse is "slashable" but does not define the detection mechanism, the nonce generation algorithm, or the on-chain proof format. A VM snapshot/restore of an operator node would silently produce nonce reuse with a stateful counter.

### Solution

**Nonce generation — RFC 9591 hybrid (not a stateful counter)**

Operators derive per-signing-request nonces as:

```
nonce_material = HKDF-SHA-512(
    IKM  = secret_share_bytes,
    salt = crypto.getRandomValues(new Uint8Array(32)),   // fresh per request
    info = "FROST-ED25519-SHA512-v1" || session_id || message_hash
)
(d_i, e_i) = reduce_mod_q(nonce_material[0:32], nonce_material[32:64])
```

The `session_id` in `info` ensures that even if the OS CSPRNG returns identical bytes after a VM restore (the counter-reset failure mode), the nonces still differ across sessions. A deterministic-only scheme per RFC 9591 Appendix B is insufficient alone because replaying the same message with the same session_id would produce identical nonces; the random salt prevents this.

**Agent nonce commitment log**

The agent maintains an append-only local log of all signed nonce commitments received from operators:

```
NonceLogEntry {
  operator_id  : Ethereum address
  session_id   : bytes32
  round_index  : uint8    // 0–4 for 5 challenges per session
  D_i          : bytes32  // compressed Ed25519 point
  E_i          : bytes32  // compressed Ed25519 point
  epoch        : uint32   // share epoch (increments on resharing)
  timestamp    : uint64
  signature    : bytes64  // operator AVS key signature over the above fields
}
```

Each operator signs its nonce commitment before sending it to the agent. The agent archives the complete set of signed commitments for each signing round to EigenDA and records the resulting EigenDA record ID locally alongside the session ID and round index. These archived commitments are the source material for fraud proof submissions.

**On-chain slashing — lazy, no Merkle proofs required**

```
slashNonceReuse(
    operatorId,
    signed_commitment_a,   // { session_id, round_index, D_i, E_i, timestamp, signature }
    signed_commitment_b    // { session_id, round_index, D_i, E_i, timestamp, signature }
)
```

The contract slashes the operator if: both signatures verify under the operator's registered AVS Ed25519 key, both commitments contain identical `(D_i, E_i)` values, and the two commitments do not have both the same `session_id` and the same `round_index`. No Merkle proofs, no elliptic curve arithmetic on-chain. The nonce commitment equality combined with valid operator signatures is conclusive proof of misbehavior — an honest operator using the hybrid scheme cannot produce identical `(D_i, E_i)` for two different sessions or rounds.

**Memory safety**

After the partial signature `z_i` is computed:
```
d_i_bytes.fill(0)
e_i_bytes.fill(0)
random_salt.fill(0)
```

Use `sodium-native`'s `sodium_memzero` where available. Disable `--inspect`, heap snapshots, and core dumps (`ulimit -c 0`) in the operator process.

**Spec changes required**

In `specs/threshold-signing/spec.md`:
- Replace "generate fresh nonce from CSPRNG" with the exact RFC 9591 hybrid derivation formula.
- Add requirement: agent maintains a nonce commitment log; duplicate `(D_i, E_i)` for the same operator across sessions is a slashable condition.
- Add requirement: partial signature scalars `(d_i, e_i)` are zeroed immediately after `z_i` is computed, before transmission.
- Add slashing scenario using the lazy signed-commitment mechanism above.

---

## H-2: FROST DKG Proof-of-Knowledge

**Threats addressed:** T-002 (rogue key attack), T-003 (VSS share forgery)

### Problem

HashID's `frost-dkg` spec describes "Feldman VSS commitments" but does not require the Schnorr proof-of-knowledge (PoK) over each operator's constant-term commitment `φ_{i0}`. Without PoK, a single malicious operator can set `φ_{j0} = T - Σ_{i≠j} φ_{i0}` after observing all other operators' broadcasts, biasing the group public key to a target `T` whose discrete log it knows. This completely breaks the threshold guarantee — the attacker can sign unilaterally.

VSS checks do not catch this: Feldman VSS verifies share consistency against the published polynomial, not that the polynomial constant term was chosen honestly.

### Solution

**The exact PoK formulas (FROST paper Figure 1 / ZCash frost-core)**

In Round 1, each operator computes and broadcasts `σ_i = (R_i, μ_i)` alongside `C_i`:

```
k  ← Z_q  (random nonce, from CSPRNG)
R_i = k · G
c_i = HDKG(i || φ_{i0} || R_i)
μ_i = k + a_{i0} · c_i  (mod q)
```

where `HDKG(x) = SHA-512("FROST-ED25519-SHA512-v1" || "dkg" || x)` reduced mod the Ed25519 group order, and `a_{i0}` is the secret constant term of operator i's polynomial.

**Verification by every receiving operator (before Round 2)**

Each operator verifies all N-1 received proofs before computing or sending any Round 2 shares:

```
c_ℓ = HDKG(ℓ || φ_{ℓ0} || R_ℓ)
assert R_ℓ == μ_ℓ · G - c_ℓ · φ_{ℓ0}
```

If any proof fails: abort ceremony, broadcast complaint identifying culprit ℓ, do not send Round 2 shares to anyone.

**Who verifies**

- Each operator verifies all peers' PoK independently — this is the primary control.
- The agent also verifies before relaying — defence in depth only. A misbehaving agent that skips verification is caught by honest operators.

**Test vectors**

ZCash publishes exact test vectors at `frost-ed25519/tests/helpers/vectors_dkg.json`:

```
Participant 1:
  φ_{10} = db67948a73033b0c886ed757d97352428df05ad5803aff256bc388c9a0772bfe
  R_1    = 64c41c1d0417aef33576c23a5150de2921d6249d7086b10012f942405fc08ed5
  μ_1    = 1a872dd021db2ac01e9f4182e950324c5f563421bd835f3f514a60c975cab70c
  a_{10} = 2d2c3e2b558e555b1608838e0ded66cd36d8aaa9ed1e39ce8474855d0825b20e
```

These must be incorporated as test fixtures for the TypeScript DKG implementation.

**Spec changes required**

In `specs/frost-dkg/spec.md`, the "Round 1 — commitment broadcast" requirement must be expanded to two explicit requirements:

1. **PoK generation** (existing commitment broadcast + PoK): operators compute and broadcast `(C_i, σ_i)` per the formulas above.
2. **PoK verification before Round 2** (new requirement): operators verify all peers' PoK using `R_ℓ == μ_ℓ · G - c_ℓ · φ_{ℓ0}` before any Round 2 computation; abort with identifiable culprit on failure.
3. **New scenario**: "Operator with invalid proof-of-knowledge is rejected before Round 2 begins" — WHEN `R_ℓ ≠ μ_ℓ·G - c_ℓ·φ_{ℓ0}`, THEN ceremony aborts with culprit complaint.

---

## H-3: Challenge Pre-commitment Binding

**Threats addressed:** T-013 (agent-machine message substitution), T-007 (agent as implicit trust anchor)

### Problem

The current design signs `sha256(challenge || session_id)`. This binds signatures to sessions (preventing cross-session replay) but does not prevent a compromised agent machine from substituting `challenge` with an attacker-controlled payload before forwarding to operators. Operators have no basis to reject the substitution — they only check that `session_id` is open on-chain.

Because the agent is the FROST coordinator for its own signing sessions, a compromised agent machine can coerce the operator network into signing arbitrary messages under the agent's threshold key, as long as it presents a valid open session.

### Solution

**Change to `initSession`**

Add `challenge_hashes: bytes32[5]` as a required parameter:

```
initSession(
    agent_pubkey:    bytes32,
    nonce:           bytes32,
    verifier_pubkey: bytes20,
    challenge_hashes: bytes32[5]    // NEW: keccak256(raw_challenge_i) for each challenge
)
```

The verifier computes each hash as `keccak256(raw_challenge_i)` before calling `initSession`. The `SessionRecord` stores `challengeHashes: bytes32[5]` alongside existing fields.

A flat array is used (not a Merkle root) because at N=5, the flat array costs ~80–100k additional gas on storage versus ~20k for a single root, but the Merkle approach adds 96 bytes of proof per challenge to every operator signing request and requires 15 on-chain keccak256 calls at session close. The flat array wins at this cardinality.

**Operator verification in Round 1 (before nonce generation)**

Before generating or broadcasting any nonce material, the operator verifies:

1. `session_id` exists on-chain with `status: OPEN` (existing).
2. `keccak256(raw_challenge) ∈ session.challenge_hashes` (new).
3. `sha256(raw_challenge || session_id) == message` (new, verifies the agent formed the message correctly).

If check 2 or 3 fails: refuse, return error, generate no nonces. Placing the check at Round 1 (before nonce commitment) is mandatory — placing it at Round 2 would allow nonce commitments to be extracted before the refusal, creating nonce-correlation surface (feeding T-001).

**Fraud detection (complementary)**

Operators emit a signed rejection receipt `{ session_id, message_hash, challenge_hash, round: "1", timestamp }` to the requesting agent when refusing a request. The agent stores rejection receipts locally alongside the session record. A pattern of operator rejections for a session is evidence of agent-machine misbehavior.

**Interaction with H-1**

The agent nonce log (H-1) now contains `message_hash` entries that are verifiable against the on-chain `challenge_hashes`. This makes it possible to detect an agent that routes a non-committed message (it would appear in the log but not match any `challenge_hashes` entry), even if the operator check catches it first.

**Spec changes required**

In `specs/on-chain-session/spec.md`:
- Add requirement: `initSession` accepts `challenge_hashes: bytes32[5]`.
- Add requirement: `SessionRecord` stores `challengeHashes`.
- Add scenario: verifier commits challenge hashes at session creation; operator rejects signing request for challenge not in committed set.

In `specs/threshold-signing/spec.md`:
- Add Round 1 pre-checks: challenge hash membership and message formation verification.
- Add scenario: operator rejects signing request where `keccak256(raw_challenge)` is not in `session.challenge_hashes`.

---

## H-4: Succession Commit-Reveal and Time-Lock

**Threats addressed:** T-026 (succession frontrunning), T-018 (succession chain injection)

### Problem

A full keypair succession transaction reveals `new_pubkey` in the mempool. An attacker with K shares (enough to forge a threshold signature) can observe `new_pubkey`, sign their own `{ new_pubkey: attacker_key, ... }` with higher gas, and file a fraudulent succession entry before the legitimate one lands. Since the chain is append-only, the fraudulent entry becomes the permanent head.

Even without frontrunning, T-018 requires a detection window: if an attacker forges a succession entry, the legitimate agent must have time to detect and contest it before verifiers walk the chain and trust the fraudulent key.

### Solution

**Two-phase commit-reveal for succession**

```
Phase 1 — COMMIT (block N):
  Submitter calls: commit(keccak256(agent_id || old_pubkey || new_pubkey || salt))
  Contract stores: commitments[agent_id] = {
      hash:         keccak256(agent_id || old_pubkey || new_pubkey || salt),
      committer:    msg.sender,
      committed_at: block.timestamp
  }
  Contract enforces: one active commitment per agent_id; prior must be expired.
  Commitment expiry: 7 days (prevents indefinite blocking by griefing commits).

Phase 2 — REVEAL (block N+K, where block.timestamp ≥ committed_at + 24 hours):
  Submitter calls: reveal(agent_id, old_pubkey, new_pubkey, salt, threshold_signature)
  Contract verifies:
    1. keccak256(agent_id || old_pubkey || new_pubkey || salt) == stored hash
    2. msg.sender == stored committer
    3. block.timestamp ≥ committed_at + 24 hours
    4. old_pubkey is current chain head for agent_id
    5. ed25519.verify(threshold_signature, keccak256(new_pubkey || timestamp || reason), old_pubkey)
    6. new_pubkey is not registered to any other agent
  On success: append succession entry, delete commitment, emit SuccessionCompleted event.
  Rate limit: minimum 1 hour between successive reveals for same agent_id.
  Chain cap: maximum 100 entries per agent_id.
```

The commit phase leaks only a 32-byte hash — an attacker watching the mempool cannot extract `new_pubkey` without knowing `salt`. Only the `committer` address can reveal, eliminating frontrun-on-reveal. The 24-hour delay between commit and reveal is the T-018 challenge window: the legitimate agent has 24 hours to detect a fraudulent commit and alert (or veto via guardian).

**Guardian (optional, veto-only)**

At bootstrap, the agent optionally registers a `guardian_address`. During the 24-hour commit window, the guardian can call `vetoSuccession(agent_id)`, which cancels the pending commitment and starts a 1-hour cooldown before re-commit is allowed. The guardian does not approve succession — it only blocks it. This is the veto-only model: succession is automatic after the timelock; the guardian is an emergency brake.

Guardian rotation uses the same commit-reveal + 24-hour timelock to prevent an attacker from first rotating the guardian to themselves and then vetoing legitimate succession.

**Implementation**

Use a custom minimal timelock scoped to succession, patterned after OZ `TimelockController` internals (same `block.timestamp`-based delay, same `bytes32` operation hash, same event naming). Do not inherit `TimelockController` — its governance-oriented interface (batch calls, predecessor chains, role-based executors) adds unnecessary surface area.

**Ed25519 on-chain verification**

The `reveal` phase verifies the threshold Ed25519 succession signature on-chain using `chfast/ed25519-solidity` (~300–500k gas, one-time cost for a rare operation). Abstract the verification call behind an interface so a future upgrade can point to a precompile (RIP-7212, available on OP Stack / Base today at ~3,400 gas) without changing succession logic.

**Spec changes required**

In `specs/key-succession/spec.md`:
- Replace "succession entry published on-chain" with the two-phase commit-reveal flow.
- Add requirement: 24-hour mandatory delay between commit and reveal.
- Add requirement: only committing address can reveal.
- Add requirement: one active commitment per agent_id; prior expired after 7 days.
- Add requirement: guardian veto (if guardian registered) cancels commitment within the 24-hour window.
- Add scenario: frontrunning attempt fails because attacker cannot know `new_pubkey` from the commit hash.
- Add scenario: 24-hour window allows detection and veto of fraudulent succession.

---

## H-5: Supply Chain and Operator Memory Isolation

**Threats addressed:** T-029 (`@noble/curves` compromise), T-030 (EigenLayer AVS SDK compromise), T-031 (Node.js memory disclosure)

### Problem

The entire FROST security model rests on `@noble/curves` producing correct, unbiased nonces and partial signatures. A single malicious npm publish silently breaks FROST. The AVS SDK, if compromised, can route signing requests to attacker-controlled endpoints.

### Solution

**Dependency hardening (build-time)**

```
.npmrc:
  frozen-lockfile=true
  trustPolicy=no-downgrade       # fail if provenance is stripped from a new release
  blockExoticSubdeps=true        # prevent git+ssh:// or https:// tarball transitive deps
  minimumReleaseAge=72h          # delay adoption of packages published in last 72h

package.json:
  "packageManager": "pnpm@10.x.x+sha224.<hash>"   # Corepack verifies pnpm binary
```

All crypto-adjacent packages use exact versions (no `^` or `~`). Any PR that modifies `pnpm-lock.yaml` triggers a CI step that diffs the full resolved package list and requires explicit reviewer sign-off on new transitive dependencies.

**Docker operator build — reproducible, offline**

```dockerfile
FROM node:22-alpine@sha256:<pinned-digest>      # immutable, not a tag
COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch                                  # populate content-addressable store
COPY . .
RUN pnpm install --offline --frozen-lockfile    # no network access; hard-fail if not in store
```

The `--offline` flag ensures the install fails rather than falling back to the live registry if any package is missing from the pre-fetched store.

**Process isolation — `child_process.fork` for the signer**

`worker_threads` share V8's address space; a compromised dependency in the parent can inspect worker memory. A forked child process has a separate virtual address space with an OS-level barrier.

```
[AVS orchestrator]                      [Signer subprocess]
  Runs EigenLayer AVS SDK                 Holds FROST key share
  Routes signing requests                 sodium_malloc'd buffer
  NEVER holds key material                mprotect_noaccess at rest
        |                                 mprotect_readwrite during signing
        +------- Unix socket (HMAC) ------+
```

The signer subprocess receives the key share once at startup via IPC, copies it into a `sodium_malloc`'d buffer, zeroes the IPC-received bytes, and sets `mprotect_noaccess`. Between signing operations the buffer is inaccessible — any read triggers SIGSEGV. `sodium_malloc` sets `MADV_DONTDUMP` (Linux), excluding the buffer from core dumps.

The IPC channel authenticates every message with an HMAC keyed on a session secret exchanged at fork time. A compromised AVS SDK module cannot inject signing requests without the HMAC key.

Apply `seccomp` (via a native addon) to the signer subprocess to whitelist only required syscalls. No outbound network access from the signer container (Docker network policy).

**Residual risk (documented, not solvable in Node.js)**

`@noble/curves` performs FROST computation in V8 JIT-compiled JavaScript. Intermediate scalar values (nonce scalars, partial signature scalars) materialize as `BigInt` or `TypedArray` in V8's heap and cannot be mlocked or zeroed by user code before GC. A T-031 memory disclosure during an active signing operation would expose these intermediate values. The stored key share (between operations) is fully protected by `sodium-native`; the transient computation values are not.

The long-term resolution is a Rust signing subprocess (via N-API or as a separate process) that manages all cryptographic memory explicitly. This eliminates V8's heap from the security-critical path entirely. Lit Protocol uses AMD SEV-SNP TEEs — the hardware-enforced equivalent if operator infrastructure supports it.

**`@noble/curves` vendoring decision**

The library has six independent audits (Cure53 ×4, Trail of Bits, Kudelski), zero runtime dependencies, and npm provenance attestations via GitHub OIDC. The risk/benefit analysis favours pinning over vendoring: vendoring shifts the risk from author-account-compromise to maintenance-negligence (skipping security patches), which is harder to detect. If the team commits to a defined audit/update cadence (every major release + any security advisory), vendoring `@noble/curves` only — not all dependencies — is a viable additional hardening step.

**Spec/infrastructure changes required**

- Add operator deployment guide specifying: Docker base image pinned to digest, pnpm `frozen-lockfile` + `trustPolicy`, `child_process.fork` architecture, `sodium-native` memory model.
- Add operator security requirements to the `frost-dkg` and `threshold-signing` specs: key share stored in locked memory; signer process has no outbound network access; signing subprocess does not log partial signatures.

---

## Cross-Cutting Contract Changes

The following `AnchorIdentity` / `SessionRegistry` changes are required across H-3 and H-4:

| Contract | Change | Hardening |
|---|---|---|
| `SessionRegistry.initSession` | Add `bytes32[5] challenge_hashes` parameter | H-3: challenge binding |
| `SessionRegistry.SessionRecord` | Add `challengeHashes: bytes32[5]` field | H-3 |
| `SessionRegistry` | Add `slashNonceReuse` with lazy signed-commitment verification | H-1 |
| `AnchorIdentity` | Add `commit(bytes32 commitment_hash)` | H-4: commit-reveal |
| `AnchorIdentity` | Add `reveal(agent_id, old_pubkey, new_pubkey, salt, sig)` with 24h timelock | H-4 |
| `AnchorIdentity` | Add `vetoSuccession(agent_id)` callable by registered guardian | H-4 |
| `AnchorIdentity` | Add rate limit: 1h between succession entries, max 100 per agent | H-4 (T-027) |
| `AnchorIdentity` | Ed25519 verification on-chain in `reveal` (abstracted for precompile upgrade) | H-4 |

All contracts should use Solidity 0.8+, OZ `ReentrancyGuard` on all state-mutating paths, OZ `Pausable` for emergency freeze, and Foundry invariant tests asserting session counter bounds and succession chain monotonicity.

---

## Implementation Priority

These hardening items should be sequenced into the `tasks.md` for `distributed-key-custody`:

1. **H-2 (DKG PoK)** — purely a spec + TypeScript DKG implementation change. No contract changes. Blocks all security guarantees downstream. Implement first.
2. **H-1 (Nonce safety)** — TypeScript operator implementation + AVS contract `slashNonceReuse`. Implement before any testnet signing.
3. **H-3 (Coordinator binding)** — `initSession` contract change + operator Round 1 pre-check. Implement before testnet verification sessions.
4. **H-4 (Succession commit-reveal)** — `AnchorIdentity` contract change. Implement before any succession ceremony is possible on testnet.
5. **H-5 (Supply chain + isolation)** — Operator build pipeline and process architecture. Implement before inviting external operators.
