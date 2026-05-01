# HashID Protocol Specification

**Version:** 0.1.0-draft  
**Date:** 2026-04-04  
**Status:** Draft

---

## Table of Contents

- [1. Abstract](#1-abstract)
- [2. Status of This Document](#2-status-of-this-document)
- [3. Notational Conventions](#3-notational-conventions)
- [4. Terminology](#4-terminology)
- [5. Protocol Overview](#5-protocol-overview)
- [6. Actors and Roles](#6-actors-and-roles)
- [7. Distributed Key Generation](#7-distributed-key-generation)
- [8. Threshold Signing Sessions](#8-threshold-signing-sessions)
- [9. Verification Protocol](#9-verification-protocol)
- [10. Key Management](#10-key-management)
- [11. On-Chain Contracts](#11-on-chain-contracts)
- [12. Economic Model](#12-economic-model)
- [13. Security Properties](#13-security-properties)
- [14. Conformance Requirements](#14-conformance-requirements)

---

## 1. Abstract

HashID is a distributed key custody protocol for autonomous agent identity. An agent's Ed25519 signing key is never held by a single party. Instead, the key is split across a network of independently staked Ethereum operators using FROST threshold signatures (RFC 9591). Producing a valid signature requires the coordinated participation of a K-of-N supermajority of operators, where K = ceil(N × 2/3).

The protocol provides three core capabilities: (1) bootstrap — establishing a new agent identity via a distributed key generation ceremony anchored on-chain and in EigenDA; (2) verification — allowing a relying party to cryptographically confirm an agent's identity through on-chain session management and threshold signing; and (3) key lifecycle management — rotating shares without changing the public key (resharing) or rotating the full keypair with a cryptographically linked succession chain.

This specification defines the protocol messages, on-chain contract interfaces, cryptographic constructions, economic parameters, and conformance requirements for all protocol participants. It is intended to be self-contained: a compliant implementation can be built from this document alone.

---

## 2. Status of This Document

This document is a **working draft** of the HashID protocol specification. It has not undergone formal security audit or independent review. The cryptographic constructions, economic parameters, and contract interfaces described herein are subject to change prior to mainnet deployment.

Implementers SHOULD treat all normative requirements as binding for testnet deployments. Mainnet conformance requirements will be finalized in a subsequent version following audit.

---

## 3. Notational Conventions

### 3.1 RFC 2119 Keywords

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

### 3.2 Notation

| Symbol | Meaning |
|--------|---------|
| `G` | Ed25519 base point (generator of the prime-order subgroup) |
| `q` | Order of the Ed25519 prime-order subgroup (2^252 + 27742317777372353535851937790883648493) |
| `Z_q` | The integers modulo `q` |
| `H(x)` | Context-dependent hash function; specific instantiation noted per use |
| `HDKG(x)` | `SHA-512("FROST-ED25519-SHA512-v1" \|\| "dkg" \|\| x) mod q` |
| `keccak256(x)` | Keccak-256 hash (Ethereum-native) |
| `sha256(x)` | SHA-256 hash |
| `sign(m, k)` | Ed25519 signature over message `m` with private key `k` |
| `ed25519.verify(sig, m, pk)` | Ed25519 signature verification |
| `X25519(sk, pk)` | X25519 Diffie-Hellman key agreement (RFC 7748) |
| `HKDF-SHA-512(IKM, salt, info)` | HKDF as defined in RFC 5869, instantiated with SHA-512 |
| `HKDF-SHA-256(IKM, salt, info)` | HKDF as defined in RFC 5869, instantiated with SHA-256 |
| `ChaCha20-Poly1305(key, nonce, pt, aad)` | AEAD encryption per RFC 8439 |
| `Enc(k, m)` | Shorthand for authenticated encryption of message `m` under key `k` |
| `\|\|` | Byte concatenation |
| `K` | Signing threshold: `ceil(N × 2/3)` |
| `N` | Total number of operators in the key share set |
| `φ_{i0}` | Operator `i`'s commitment constant term: `a_{i0} · G` |
| `C_i[k]` | Operator `i`'s k-th Feldman VSS commitment point |
| `s_i` | Operator `i`'s FROST key share (scalar in `Z_q`) |
| `(D_i, E_i)` | Operator `i`'s nonce commitment points |
| `(d_i, e_i)` | Operator `i`'s nonce scalars |
| `z_i` | Operator `i`'s partial signature scalar |
| `ρ_i` | Binding factor for operator `i` |
| `λ_i` | Lagrange interpolation coefficient for operator `i` |
| `c` | FROST challenge scalar |

---

## 4. Terminology

| Term | Definition |
|------|-----------|
| **Agent** | An autonomous software entity whose cryptographic identity is managed by the protocol. The agent holds no private key material — only a control key. |
| **Agent Deployer** | The party that invokes the bootstrap ceremony to establish an agent's identity. |
| **AnchorIdentity** | On-chain contract storing the binding between an agent's group public key, control public key, EigenDA record ID, and database commitment. |
| **AVS** | Actively Validated Service — an EigenLayer service contract that defines operator obligations, slashing conditions, and reward distribution. |
| **Bootstrap** | The one-time ceremony that establishes a new agent identity via FROST DKG, EigenDA storage, and on-chain anchoring. |
| **Commitment List** | The canonically encoded set of K nonce commitment points used to compute binding factors during FROST signing. |
| **Control Key** | A single-party Ed25519 key pair held on the agent machine. The control public key is registered on-chain. Every signing request MUST include an authorization token signed by the control key. |
| **Coverage Ceiling** | The maximum agent asset value for which the protocol provides slashing-based economic deterrence: `K × operator_stake × max_slash_fraction / safety_margin`. |
| **Database Commitment (db_commitment)** | A FROST Ed25519 threshold signature over `sha256(agent_id \|\| threshold_pubkey \|\| control_pubkey)`, proving the key holders endorsed the identity record. |
| **DKG** | Distributed Key Generation — a multi-party protocol that produces a shared public key and individual key shares without any single party seeing the full private key. |
| **EigenDA** | EigenLayer's data availability layer, used to store agent identity records with on-chain commitment. |
| **EigenLayer** | Ethereum restaking protocol providing the economic security layer (staked ETH, slashing enforcement). |
| **Epoch** | A monotonically increasing counter tracking share generations. Incremented on each successful resharing. |
| **Equivocation** | An operator producing an authenticated signature for a session that does not exist in `SessionRegistry`. The highest-severity slashable offense. |
| **Feldman VSS** | Verifiable Secret Sharing scheme where the dealer publishes commitments to polynomial coefficients, allowing recipients to verify share correctness. |
| **FROST** | Flexible Round-Optimized Schnorr Threshold signature scheme, per RFC 9591. |
| **FROST-SHARE-ECIES-v1** | The fully specified ECIES construction for encrypting DKG Round 2 shares between operators. Uses X25519 ECDH, HKDF-SHA-256, and ChaCha20-Poly1305. |
| **Group Public Key** | The Ed25519 public key derived from the DKG ceremony. Indistinguishable from a single-party key. This is the agent's externally visible identity key. |
| **Guardian** | An optional address registered on an agent's identity record with veto power over succession commitments. Serves renewable 6-month terms. |
| **Key Share** | A single operator's portion of the FROST private key. Stored in secure, persistent storage on the operator's infrastructure. |
| **Operator** | An EigenLayer restaker running the HashID AVS node software. Each operator holds exactly one FROST key share per agent and participates in signing sessions. |
| **Partial Signature** | A scalar `z_i` produced by an operator during Round 2 of FROST signing, using its key share and nonce. |
| **ProactiveSS** | Proactive Secret Sharing — a resharing protocol that produces new shares for the same public key, cryptographically invalidating old shares. |
| **Rejection Receipt** | A signed message from an operator to the agent explaining why a signing request was refused. Used for diagnostics and misbehavior detection. |
| **Resharing** | Rotating key shares across the operator set without changing the group public key. Uses ProactiveSS. |
| **Session** | An on-chain record in `SessionRegistry` representing a single verification interaction. Has lifecycle states: OPEN, SPENT, EXPIRED. |
| **SessionRegistry** | On-chain contract managing verifier registration, session lifecycle, rate limiting, fee escrow, and slashing for session-related misbehavior. |
| **Succession** | Full keypair rotation where a new group public key replaces the old one. The old key signs the new key, creating a cryptographically linked chain. |
| **SuccessionRegistry** | On-chain contract managing commit-reveal succession ceremonies, guardian veto, and control key rotation. |
| **Verifier** | A relying party that cryptographically confirms an agent's identity by opening an on-chain session, issuing challenges, and verifying threshold signatures. |
| **VRF Sampling** | Verifiable Random Function-based operator selection. Uses `keccak256(session_id \|\| session.vrf_randao)` as a deterministic, publicly verifiable seed to select K operators per session. |
| **Watcher** | Any party that monitors on-chain data and operator behavior for misbehavior, submitting fraud proofs to earn the 20% slash reward. |

---

## 5. Protocol Overview

HashID establishes and manages cryptographic identities for autonomous agents. The protocol distributes trust across a network of staked Ethereum operators so that no single party — including the agent itself — can forge signatures or compromise the identity.

### 5.1 Architecture

```
                                    ┌─────────────────────────────┐
                                    │       Ethereum Chain        │
                                    │                             │
                                    │  ┌───────────────────────┐  │
                                    │  │    AnchorIdentity     │  │
                                    │  │  group_pubkey         │  │
                                    │  │  control_pubkey       │  │
                                    │  │  eigenda_record_id    │  │
                                    │  │  db_commitment        │  │
                                    │  │  guardian             │  │
                                    │  └───────────────────────┘  │
                                    │                             │
                                    │  ┌───────────────────────┐  │
                                    │  │   SessionRegistry     │  │
                                    │  │  verifier bonds       │  │
                                    │  │  session lifecycle    │  │
                                    │  │  fee escrow           │  │
                                    │  │  slash functions      │  │
                                    │  └───────────────────────┘  │
                                    │                             │
                                    │  ┌───────────────────────┐  │
                                    │  │  SuccessionRegistry   │  │
                                    │  │  commit-reveal        │  │
                                    │  │  guardian veto        │  │
                                    │  │  control key rotation │  │
                                    │  └───────────────────────┘  │
                                    │                             │
                                    │  ┌─────────────────────────┐│
                                    │  │  ServiceManager         ││
                                    │  │  operator registry      ││
                                    │  │  stake tiers            ││
                                    │  │ participation tracking  ││
                                    │  └─────────────────────────┘│
                                    └──────────────┬──────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │                              │                              │
              ┌─────┴─────┐              ┌─────────┴─────────┐            ┌──────┴──────┐
              │   Agent   │              │  EigenLayer AVS   │            │   Verifier  │
              │           │              │  Operator Network │            │             │
              │ hashid-cli│◄────────────►│                   │            │  Hono HTTP  │
              │           │  direct P2P  │  ┌──┐ ┌──┐ ┌──┐   │            │  server     │
              │ control   │  (signing,   │  │O1│ │O2│ │ON│   │            │             │
              │ key only  │   DKG)       │  └──┘ └──┘ └──┘   │            │ bond +      │
              └─────┬─────┘              │  each holds one   │            │ sessions    │
                    │                    │  FROST key share  │            └──────┬──────┘
                    │                    └───────────────────┘                   │
                    │                              │                             │
                    │                    ┌─────────┴─────────┐                   │
                    └───────────────────►│     EigenDA       │◄──────────────────┘
                     write identity      │  identity records │   read identity
                     record              │  nonce archives   │   record
                                         └───────────────────┘
```

### 5.2 Protocol Phases

The protocol operates in three distinct phases:

1. **Bootstrap** — A one-time ceremony that creates a new agent identity. The agent CLI drives a FROST DKG ceremony across N operators, publishes the identity record to EigenDA, and anchors the group public key on-chain. After bootstrap, each operator holds one key share. The agent holds only a control key.

2. **Verification** — The runtime protocol. A verifier opens an on-chain session, commits challenge hashes, sends challenges to the agent, and the agent coordinates a threshold signing ceremony with VRF-sampled operators. The verifier validates signatures against the on-chain public key and marks the session as spent.

3. **Key Management** — Ongoing lifecycle operations. Resharing rotates shares without changing the public key. Full succession rotates the keypair with a commit-reveal ceremony and 24-hour timelock. Control key rotation handles agent-machine compromise without a full DKG.

### 5.3 Trust Model

The protocol's security rests on two independent factors:

- **Factor 1 (control key):** The agent's single-party Ed25519 control key, held only on the agent machine. Required to authorize every signing request.
- **Factor 2 (threshold shares):** K-of-N FROST key shares, held by independent staked operators. Required to produce a valid group signature.

Neither factor alone is sufficient. Stealing the control key does not enable forgery without K cooperating operators. Compromising K operator shares does not enable forgery without the control key's authorization token.

---

## 6. Actors and Roles

| Actor | Description | Key Obligations |
|-------|-------------|-----------------|
| **Agent Deployer** | Initiates bootstrap; manages the agent CLI | Drive DKG ceremony; anchor identity on-chain; manage control key securely; initiate resharing or succession when needed |
| **Operator** | EigenLayer restaker running HashID AVS software | Hold key shares in secure storage; participate in signing sessions when VRF-selected; acknowledge sessions within 2 minutes; confirm resharing within 30 minutes; submit deletion attestations within 24 hours; never reuse nonces |
| **Verifier** | Relying party authenticating agent identity | Register on-chain with bond; open sessions with committed challenge hashes; verify signatures; spend sessions on-chain; cache public keys with ≤5-minute TTL |
| **Guardian** | Optional veto authority for an agent's succession | Monitor for unauthorized succession commitments; veto within 24-hour timelock window; renew 6-month term before expiry |
| **Watcher** | Third-party fraud proof submitter | Monitor operator behavior and on-chain state; submit valid slash proofs to earn 20% watcher reward |
| **EigenLayer** | Restaking infrastructure | Enforce operator stake minimums; process slash transactions; distribute rewards via `RewardCoordinator` |

---

## 7. Distributed Key Generation

### 7.1 Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Signature scheme | `Ed25519` | Standard agent identity key; indistinguishable from single-party key |
| DKG protocol | FROST DKG (RFC 9591) with Feldman VSS | No trusted dealer; verifiable commitments |
| Threshold (K) | `ceil(N × 2/3)` | BFT-standard supermajority |
| Minimum N (production) | 10 | N=5 K=4 is attacker-favorable; N=10 K=7 is defender-favorable |
| Share encryption | FROST-SHARE-ECIES-v1 | X25519 ECDH + HKDF-SHA-256 + ChaCha20-Poly1305 |

### 7.2 Preconditions

Before a DKG ceremony begins:

- The agent deployer SHALL generate a control key pair (`Ed25519`) on the agent machine. The control private key SHALL NOT be transmitted to any party.
- The agent CLI SHALL read the on-chain operator registry to obtain each operator's endpoint URL, AVS Ed25519 public key, and X25519 public key.
- The AVS contract SHALL verify that no single Ethereum address controls more than `N - K` of the total operator seats. `DKGInit` SHALL revert if any address exceeds this concentration limit.
- `DKGInit` SHALL revert if any operator in the proposed N-set lacks a registered `x25519_pubkey`.
- For production deployments, `DKGInit` SHALL revert if N < 10.

### 7.3 DKG Flow

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Agent CLI
    participant Ops as Operators (1..N)
    participant EigenDA as EigenDA
    participant Chain as Ethereum

    Agent->>Ops: DKGInit(session_id, K, N)

    Note over Ops: Round 1 — Commitment + Proof of Knowledge

    Ops->>Ops: Generate secret polynomial f_i(x), degree K-1
    Ops->>Ops: Compute Feldman VSS commitments C_i[0..K-1]
    Ops->>Ops: Compute PoK: k ← Z_q, R_i = k·G, c_i = HDKG(i || φ_{i0} || R_i), μ_i = k + a_{i0}·c_i mod q
    Ops->>Agent: Broadcast (C_i, σ_i = (R_i, μ_i))
    Agent->>Ops: Relay all peer commitments

    Note over Ops: PoK Verification Gate

    Ops->>Ops: For each peer l: verify R_l == μ_l·G - c_l·φ_{l0}
    alt Any PoK fails
        Ops->>Agent: Complaint(invalid_pok, culprit=l)
        Note over Agent: Ceremony aborted — no Round 2
    end

    Note over Ops: Round 2 — Encrypted Share Exchange (FROST-SHARE-ECIES-v1)

    Ops->>Ops: For each peer j: encrypt share s_i(j) to j's x25519_pubkey
    Ops->>Ops: Sign full wire payload with Ed25519 AVS key
    Ops->>Ops: Send encrypted share + signature to peer

    Ops->>Ops: Verify Ed25519 sig; decrypt; run Feldman VSS check
    alt Sig invalid
        Ops->>Agent: RejectionReceipt(unauthenticated-share)
        Note over Ops: Sender treated as absent
    end
    alt VSS check fails (sig valid)
        Ops->>Agent: Complaint(invalid_share, evidence=wire_payload+sig+plaintext)
        Note over Agent: Ceremony aborted; slashBadShare available
    end

    Note over Ops: Key Derivation

    Ops->>Ops: group_pubkey = Σ C_i[0] for all i
    Ops->>Ops: Reject if group_pubkey equals identity point
    Agent->>Ops: ConfirmGroupPubkey(session_id)
    Ops->>Agent: group_pubkey (confirmed)

    Note over Agent: db_commitment via threshold signature

    Agent->>Ops: SigningRound1(sha256(agent_id || threshold_pubkey || control_pubkey))
    Ops->>Agent: Partial signatures
    Agent->>Agent: FROST aggregation → db_commitment

    Agent->>EigenDA: Write(identity_record, db_commitment)
    EigenDA->>Agent: eigenda_record_id

    Agent->>Chain: AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment [, guardian])
    Chain->>Agent: tx_confirmed
```

### 7.4 Round 1 — Commitment and Proof of Knowledge

Each operator SHALL generate a secret polynomial `f_i(x)` of degree `K-1`, compute Feldman VSS commitments `C_i[0..K-1]`, and compute a Schnorr proof-of-knowledge over the constant-term commitment.

The PoK `σ_i = (R_i, μ_i)` is computed as:

```
k  ← Z_q           (sampled from CSPRNG)
R_i = k · G
c_i = HDKG(i || φ_{i0} || R_i)
μ_i = k + a_{i0} · c_i mod q
```

where `HDKG(x) = SHA-512("FROST-ED25519-SHA512-v1" || "dkg" || x) mod q`.

Each operator SHALL verify all N-1 received PoK proofs before computing or sending any Round 2 share material:

```
c_l = HDKG(l || φ_{l0} || R_l)
assert R_l == μ_l · G - c_l · φ_{l0}
```

If any proof fails, the operator SHALL abort the ceremony, broadcast a complaint identifying the culprit, and SHALL NOT send any Round 2 shares.

**Rationale:** The PoK prevents the rogue key attack where a malicious operator biases the group public key to one it controls by choosing its constant term as a cancellation of others' contributions.

### 7.5 Round 2 — Encrypted Share Exchange (FROST-SHARE-ECIES-v1)

Each operator SHALL compute a secret share for every other operator, encrypt it using the FROST-SHARE-ECIES-v1 construction, and send it point-to-point.

**Encryption procedure (operator `i` → operator `j`):**

```
ephemeral_sk  ← random_scalar()          // MUST be fresh per transmission
ephemeral_pk  ← X25519(ephemeral_sk, G)
shared_secret ← X25519(ephemeral_sk, operator_j.x25519_pubkey)

prk     ← HKDF-Extract(salt=SHA-256(session_id), ikm=shared_secret)
enc_key ← HKDF-Expand(prk,
              info="frost-share-v1" || session_id || sender_index_u16be || recipient_index_u16be,
              length=32)
nonce   ← SHA-256(session_id || sender_index_u16be || recipient_index_u16be || 0x02)[0:12]

wire_header = ephemeral_pk || sender_index_u16be || recipient_index_u16be
ciphertext  ← ChaCha20-Poly1305(key=enc_key, nonce=nonce, pt=scalar_share_le32, aad=wire_header)

payload = wire_header || ciphertext
sig     ← sign(payload, i.avs_ed25519_privkey)
send(payload || sig)
```

**Wire format:** `ephemeral_pk(32) || sender_index(2) || recipient_index(2) || ciphertext(48) || sig(64)` = 148 bytes.

The Ed25519 signature MUST cover the full wire payload including `ephemeral_pk`. This prevents the ephemeral key substitution framing attack where a MITM replaces the ephemeral key to manufacture slashable evidence against an honest operator.

Every transmission attempt MUST use a freshly generated ephemeral X25519 scalar. The nonce is deterministic and session-scoped; reusing the ephemeral key produces identical ECDH output, identical derived key, and ChaCha20-Poly1305 nonce reuse — voiding the AEAD's authentication guarantee.

### 7.6 Share Verification and Dispute

Upon receiving a Round 2 message, the recipient SHALL:

1. Verify the Ed25519 signature against the sender's registered AVS key. If invalid, discard the message and treat the sender as absent. No slashing is available for unauthenticated messages.
2. Decrypt the ciphertext using the recipient's X25519 private key.
3. Run the Feldman VSS check: `decrypted_share · G == Σ_k(C_sender[k] · recipient_index^k)`.

If the signature is valid but the VSS check fails, the recipient SHALL broadcast a ceremony complaint. The ceremony aborts. The recipient MAY submit `slashBadShare(operator_id, wire_payload, sig, decrypted_share, recipient_index)` on-chain; the contract verifies `decrypted_share · G ≠ Σ_k(C_i[k] · recipient_index^k)` against the sender's Round 1 commitments.

**Infeasibility of share forgery:** The combination of public Feldman VSS commitments and mandatory PoK makes inconsistent-polynomial share forgery infeasible. The VSS check `s · G == Σ_k(C_j[k] · i^k)` has exactly one solution in `Z_q` per index. An operator cannot construct a different scalar that passes the check without solving discrete log on Ed25519.

### 7.7 Public Key Derivation

After Round 2, the group public key SHALL be derived as:

```
group_pubkey = Σ C_i[0]   for all i in {1..N}
```

The derived key SHALL be a valid 32-byte compressed Edwards25519 point. `AnchorIdentity` SHALL revert if `group_pubkey` equals the identity point (encoded as `0x0100000000000000000000000000000000000000000000000000000000000000`).

### 7.8 Identity Anchoring

After all N operators confirm the group public key, the agent:

1. Obtains a `db_commitment` by coordinating a FROST threshold signature over `sha256(agent_id || threshold_pubkey || control_pubkey)`. The `db_commitment` proves the key holders endorsed the identity record.
2. Writes the identity record (containing agent ID, threshold public key, control public key, and key share commitments) to EigenDA. Receives `eigenda_record_id`.
3. Calls `AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment [, guardian_address])` on Ethereum. The guardian address is optional.

### 7.9 Resharing Authorization

Before a resharing ceremony begins, the proposed new operator set MUST be endorsed by the current K-of-N operators via a FROST threshold signature. The endorsement payload is:

```
sha256(agent_id || keccak256(sorted new_operator_addresses) || new_K || new_N || timestamp)
```

The agent submits the assembled threshold signature on-chain via `authorizeResharing(agent_id, new_operator_set, new_K, new_N, timestamp, threshold_signature)`. The contract verifies the signature against the agent's current registered `group_pubkey`. `DKGInit` for resharing SHALL revert if no valid on-chain authorization exists. Authorizations are single-use and expire after 1 hour.

---

## 8. Threshold Signing Sessions

### 8.1 Operator Discovery and VRF Sampling

Before initiating a signing request, the agent SHALL:

1. Read the on-chain operator registry to obtain the full list of eligible operators (registered, stake above AVS minimum for the applicable tier).
2. Compute the VRF seed: `seed = keccak256(session_id || session.vrf_randao)`, where `session.vrf_randao` is `block.prevrandao` from the `initSession` block.
3. Rank all eligible operators by `keccak256(seed || operator_id)`.
4. Select the K operators with the lowest hash values.

This computation is deterministic and independently verifiable by any party from on-chain data. `block.prevrandao` is beacon chain RANDAO — unpredictable before the block is produced, preventing verifier grinding.

### 8.2 Session Acknowledgment

Upon detecting a new `initSession` event, each VRF-selected operator SHALL submit `acknowledgeSession(session_id, operator_id, sig)` to `SessionRegistry` within **2 minutes** of session creation. The `sig` field is an Ed25519 signature over `keccak256("ack" || session_id || operator_id)` using the operator's AVS key. The contract verifies VRF membership on-chain. Failure to acknowledge is slashable via `slashNonAcknowledgment`.

### 8.3 Round 1 — Pre-checks and Nonce Generation

Before generating any nonce material, an operator SHALL verify:

1. The session exists on-chain with `status: OPEN`
2. The auth token is valid: `ed25519.verify(auth_token, session_id || message_hash || token_nonce, control_pubkey)` where `control_pubkey` is snapshotted from `AnchorIdentity` at `initSession` time
3. The `token_nonce` has not been seen in a prior request within this session
4. `keccak256(raw_challenge)` is in `session.challenge_hashes`
5. `sha256(raw_challenge || session_id) == message`
6. The operator's staked balance meets the AVS minimum
7. The epoch in the signing request matches the operator's current active share epoch

If any check fails, the operator SHALL reject the request, emit a signed rejection receipt, and generate no nonce material.

**Nonce derivation (RFC 9591 hybrid HKDF scheme):**

```
nonce_material = HKDF-SHA-512(
    IKM  = secret_share_bytes,
    salt = crypto.getRandomValues(new Uint8Array(32)),
    info = "FROST-ED25519-SHA512-v1" || session_id || message_hash
)
(d_i, e_i) = reduce_mod_q(nonce_material[0:32], nonce_material[32:64])
```

The `info` field binding to `session_id || message_hash` is the **primary structural defense** against nonce reuse. Because this pair uniquely identifies the signing context, the HKDF output differs for any two distinct contexts, even if the CSPRNG produces an identical salt. The random salt provides defense against precomputation by an attacker who later recovers `secret_share_bytes`.

`session_id` is always `bytes32` (derived by `keccak256(...)` in `initSession`), making the `info` field concatenation canonically unambiguous.

The operator SHALL sign the nonce commitment with its AVS key:

```
sign({ session_id, round_index, epoch, D_i, E_i, timestamp }, avs_key)
```

### 8.4 Canonical Commitment List Encoding

When computing binding factors `ρ_i = H("rho" || i || message || commitment_list)` per RFC 9591 §4.3, all participants SHALL use an identical canonical encoding. The commitment list SHALL be sorted by share index ascending. Each entry SHALL be encoded as:

```
2-byte big-endian share index || 32-byte compressed point D_i || 32-byte compressed point E_i
```

Arrival order, registration order, and address order SHALL NOT be used as sort keys.

### 8.5 Round 2 — Partial Signature Computation

Upon receiving the aggregated nonce commitment from the agent, each operator SHALL:

1. Re-verify the session is still `status: OPEN` on-chain.
2. If the current active share epoch no longer matches the epoch in the Round 1 commitment, send a signed rejection receipt with reason `"epoch-changed-between-rounds"` and abort.
3. Compute the partial signature: `z_i = d_i + e_i · ρ_i + λ_i · s_i · c` per RFC 9591.
4. Send `{ operator_id, partial_sig: z_i }` directly to the agent.
5. Overwrite nonce scalar bytes `d_i` and `e_i` with zeros before any other operation (defense-in-depth against memory exfiltration).

### 8.6 Aggregation and Verification

After collecting K partial signatures, the agent SHALL:

1. Aggregate: `z = Σ z_i mod q`, forming the Ed25519 signature `(R, z)` where `R` is the aggregated nonce point.
2. Verify: `ed25519.verify(sig, message, group_pubkey)`.
3. Only accept the signature if verification passes. On failure, discard and retry.

### 8.7 Liveness and Retry

If fewer than K valid responses arrive in Round 1 or Round 2 within **5 minutes**, the signing request expires. The on-chain session remains OPEN and unspent. The agent MAY retry with a fresh VRF sample (which may select a different operator set).

If an operator has generated nonce material for a `session_id` that is no longer on-chain (e.g., due to a block reorg), the operator MUST discard the nonce material immediately and SHALL NOT use it in any future request.

### 8.8 Rate Limiting

Operators SHALL enforce a per-agent rate limit of **60 signing requests per hour** per `agent_pubkey` (rolling 60-minute window). Operators SHALL also enforce a connection-level rate limit (at least as strict as the signing rate limit) that rejects excess requests with HTTP 429 before performing any cryptographic verification.

---

## 9. Verification Protocol

### 9.1 Session Creation

A registered verifier SHALL create a session by calling:

```
initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)
```

where `challenge_hashes` is a `bytes32[5]` array of `keccak256` hashes of the five challenges the verifier intends to issue.

The contract SHALL record:

```
{
    session_id:        keccak256(verifier_pubkey || agent_pubkey || nonce || blockhash(block.number - 1)),
    agent_pubkey:      agent_pubkey,
    nonce:             nonce,
    verifier_pubkey:   verifier_pubkey,
    challenge_hashes:  challenge_hashes,
    control_pubkey:    AnchorIdentity[agent_pubkey].control_pubkey,
    vrf_randao:        block.prevrandao,
    status:            OPEN,
    created_at:        block.timestamp
}
```

The verifier SHALL NOT send raw challenges to the agent until the `initSession` transaction is confirmed on-chain.

### 9.2 Challenge-Response Flow

```mermaid
sequenceDiagram
    autonumber
    participant V as Verifier
    participant Chain as SessionRegistry
    participant A as Agent CLI
    participant Ops as VRF-Sampled Operators (K)

    V->>V: Select 5 challenges; compute keccak256 hashes
    V->>Chain: initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)
    Chain->>V: session_id (status: OPEN)

    V->>A: ChallengeRequest([c1..c5], session_id)

    loop For each challenge c_i
        A->>A: Compute VRF ranking; select K operators
        A->>A: Generate token_nonce; compute auth_token = sign(session_id || sha256(c_i || session_id) || token_nonce, control_privkey)
        A->>Ops: SigningRound1(session_id, message=sha256(c_i || session_id), auth_token, token_nonce)
        Ops->>Ops: Pre-checks (7 verifications)
        Ops->>A: NonceCommitment (signed)
        A->>Ops: SigningRound2(aggregated_nonce_commitment)
        Ops->>A: PartialSignature
        A->>A: FROST aggregation; local verification
    end

    A->>V: [sig_1, sig_2, sig_3, sig_4, sig_5]

    V->>V: For each (c_i, sig_i): ed25519.verify(sig_i, sha256(c_i || session_id), group_pubkey)

    alt All 5 valid
        V->>Chain: spendSession(session_id, [sig_1..sig_5])
        Chain->>Chain: Verify all 5; mark SPENT
    else Any invalid
        V->>V: Return { verified: false }
        Note over V,Chain: Session remains OPEN for retry
    end
```

### 9.3 Session Spending

`spendSession(session_id, signatures[5])` SHALL:

1. Require `session.status == OPEN`.
2. Require `msg.sender == session.verifier_address`.
3. Verify all 5 Ed25519 signatures: for each index `i`, `ed25519.verify(signatures[i], sha256(session.challenge_hashes[i] || session_id), session.agent_pubkey)`.
4. If all pass, atomically set `session.status = SPENT`.
5. If any fail, revert. The session remains OPEN.

Only the session's registered verifier MAY call `spendSession`. Calls from any other address SHALL revert.

### 9.4 Session Expiry

A session with `status: OPEN` that has not been spent within **30 minutes** of creation SHALL be expired. Expired sessions release no spending rights and are ineligible for signing. Operators SHALL treat sessions older than 30 minutes as invalid.

### 9.5 Rate Limiting

| Limit | Value | Scope |
|-------|-------|-------|
| Per-verifier open sessions | 10 | Per `verifier_address` |
| Per-agent open sessions | N × 2 | Per `agent_pubkey`, across all verifiers |
| Signing requests per agent | 60/hour | Per `agent_pubkey`, enforced by operators |

### 9.6 Nonce Commitment Archival

After collecting all K signed nonce commitments for a signing round, the agent SHALL attempt to archive the complete set to EigenDA. The agent records the resulting EigenDA record ID locally. Archived commitments are the source material for `slashNonceReuse` fraud proof submissions. Archival failure does not block signing.

### 9.7 Public Key Resolution

Verifiers SHALL resolve an agent's current public key by walking the on-chain succession chain from the initial anchor to the key with no outgoing succession entry.

- Verifiers SHALL cache the resolved key for at most **5 minutes**.
- Verifiers SHOULD subscribe to `SuccessionPublished` events via WebSocket for low-latency invalidation.
- Verifiers SHALL wait until a `SuccessionPublished` event is at least **6 blocks deep** before treating it as final (re-org protection).
- Verifiers SHOULD poll `eth_getLogs` every **60 seconds** as a fallback under WebSocket outage.

```solidity
event SuccessionPublished(
    bytes32 indexed agentPubkey,
    bytes32 newPubkey,
    uint256 timestamp,
    uint256 blockNumber
);
```

The `indexed agentPubkey` enables per-agent log filtering at the RPC node.

---

## 10. Key Management

### 10.1 Key Lifecycle States

```
                                    ┌──────────────┐
                              ┌────►│    ACTIVE     │◄─────────────────────────┐
                              │     └──┬────┬───┬───┘                          │
                              │        │    │   │                              │
                       DKG    │  reshare│    │   │ commitControlKeyRotation    │ revealControlKeyRotation
                    completes │  starts │    │   │                              │
                              │        ▼    │   ▼                              │
┌──────────────┐              │ ┌──────────┐│ ┌─────────────────────────┐      │
│ BOOTSTRAPPING├──────────────┘ │RESHARING ││ │CONTROL_KEY_ROTATION_PENDING├───┘
└──────────────┘                └──────────┘│ └─────────────────────────┘
                                           │
                              commitSuccession
                                           │
                                           ▼
                              ┌──────────────────────┐
                              │  SUCCESSION_PENDING   │
                              └──────────┬───────────┘
                                24h + no veto
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │      ROTATING         │
                              └──────────┬───────────┘
                               confirmed │
                                         ▼
                              ┌──────────────────────┐
                              │     SUPERSEDED        │
                              └──────────────────────┘
```

### 10.2 FROST Resharing (Share Rotation)

Resharing uses ProactiveSS to derive a new share set from the existing set. The group public key is invariant. Verifiers are unaffected.

**Two-phase confirmation protocol (on-chain):**

**Phase 1 — Distribute and Acknowledge:** New shares are generated and distributed. Old shares remain valid. Each operator, upon validating its new share via Feldman VSS, SHALL call `ackShareReceived(epoch, sig)` on the AVS contract.

**Phase 2 — Confirm:** Within 30 minutes, each operator SHALL call `confirmResharing(epoch, sig)`. When all N confirmations arrive, the contract emits `ResharingCompleted(epoch, block.timestamp, operator_set_hash)`.

**Abort:** If fewer than N confirmations within 30 minutes, any party MAY call `abortResharing(epoch)`. Old shares remain valid. New shares are discarded.

**Deletion attestation:** After `ResharingCompleted`, each operator SHALL submit a signed deletion attestation within **24 hours**: `sign({ operator_id, old_epoch, action: "shares_deleted", timestamp }, operator_key)`. Failure to attest is slashable with escalating penalties.

### 10.3 Full Keypair Succession

When the private key is confirmed compromised, a full succession rotates both the group key and control key.

**Commit phase:** The initiating party submits a commitment to `SuccessionRegistry`:

```
keccak256(agent_id || old_group_pubkey || new_group_pubkey || old_control_pubkey || new_control_pubkey || salt)
```

Only the agent's control key address or the registered guardian MAY call `commitSuccession`. The commitment expires after **48 hours** if not revealed.

**24-hour timelock:** A mandatory delay before the reveal. During this window, the guardian MAY call `vetoSuccession(agent_id)` to permanently cancel the commitment.

**Reveal phase:** After 24 hours, the committing address calls `revealSuccession(agent_id, old_pubkey, new_pubkey, salt)`. The contract verifies:

1. The hash matches the stored commitment
2. The caller is the original committer
3. 24 hours have elapsed
4. The Ed25519 signature from the old group key over `{ new_pubkey, timestamp, reason }` is valid

On success, the succession entry is written. The old key is marked SUPERSEDED. Operators delete old shares.

**Rate limiting:** Minimum 1 hour between successive `commitSuccession` calls. Maximum chain length: 100 entries.

### 10.4 Threshold-Endorsed Succession (Stolen Control Key Recovery)

When an attacker has stolen the control key and is spamming `commitSuccession` at the rate limit, the agent MAY bypass `commitSuccession` via `initiateSuccessionWithEndorsement(agent_id, new_group_pubkey, new_control_pubkey, timestamp, threshold_signature)`.

The contract verifies the K-of-N FROST threshold signature against the agent's `group_pubkey`. This call supersedes any pending attacker commitment and resets the rate limit. The standard 24-hour timelock and guardian veto still apply.

### 10.5 Standalone Control Key Rotation

When the control key is compromised but FROST shares are unaffected:

1. **Commit:** `commitControlKeyRotation(keccak256(agent_id || old_control_pubkey || new_control_pubkey || salt))`
2. **Endorse:** K-of-N operators threshold-sign `{ agent_id, new_control_pubkey, timestamp }`
3. **Reveal (after 24h):** `revealControlKeyRotation(agent_id, old_control_pubkey, new_control_pubkey, salt, threshold_signature)`

The group public key, share epoch, and succession chain are unchanged.

### 10.6 Guardian Management

- Guardians serve **6-month renewable terms**. The guardian SHALL sign a renewal transaction before term expiry.
- If the term expires without renewal, succession proceeds with the 24-hour timelock only — no veto capability.
- Guardian rotation uses the same commit-reveal + 24-hour timelock.
- **Emergency guardian rotation** via `rotateGuardianWithEndorsement(agent_id, new_guardian_address, timestamp, threshold_signature)` bypasses the timelock and the current guardian's veto. Requires K-of-N threshold signature. This is the recovery path when the guardian key is compromised.

### 10.7 Succession Chain Traversal

Each succession entry is signed by the outgoing key, creating a cryptographically linked chain:

```
Genesis Anchor        Succession Entry 1       Succession Entry 2       Active
┌──────────────┐     ┌───────────────────┐     ┌───────────────────┐     ┌──────────────┐
│ AnchorIdentity│────►│ old: pubkey_0     │────►│ old: pubkey_1     │────►│ AnchorIdentity│
│ pubkey_0     │     │ new: pubkey_1     │     │ new: pubkey_2     │     │ pubkey_2     │
│ eigenda_id_0 │     │ sig: old_key signs│     │ sig: old_key signs│     │ (no outgoing) │
└──────────────┘     └───────────────────┘     └───────────────────┘     └──────────────┘
```

Traversal is linear: start at genesis, follow entries until no outgoing entry exists. The chain is append-only; entries cannot be modified or deleted.

---

## 11. On-Chain Contracts

### 11.1 Contract Summary

| Contract | Purpose | Key State |
|----------|---------|-----------|
| **AnchorIdentity** | Identity anchor; stores the binding between group key, control key, EigenDA record, and db_commitment | `group_pubkey`, `control_pubkey`, `eigenda_record_id`, `db_commitment`, `guardian`, `minVerifierBond` |
| **SessionRegistry** | Session lifecycle; verifier bonds; fee escrow; session-related slashing | Session records, verifier bond balances, open session counts, fee escrow, operator claimable balances |
| **SuccessionRegistry** | Commit-reveal succession; guardian veto; control key rotation | Pending commitments, succession entries, guardian terms |
| **ServiceManager** | Operator registration; stake tier enforcement; participation tracking | Operator registry (endpoints, AVS keys, X25519 keys, stake), `sessionsAssigned`, `sessionsParticipated`, `lowParticipationFlag` |
| **DKGContract** | DKG ceremony state; resharing coordination | DKG sessions, resharing authorizations, `ackShareReceived` records, `confirmResharing` counts |

### 11.2 Key Contract Functions

**AnchorIdentity:**
- `anchor(group_pubkey, control_pubkey, eigenda_record_id, db_commitment [, guardian])` — register new identity
- Reverts if `group_pubkey` equals identity point

**SessionRegistry:**
- `initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)` — create session (requires fee deposit + bond check)
- `spendSession(session_id, signatures[5])` — mark session SPENT (verifier only; verifies all 5 signatures)
- `acknowledgeSession(session_id, operator_id, sig)` — operator liveness signal (2-min window)
- `withdrawBond()` — pull-payment for bond/reward claims
- `claimOperatorBalance()` — pull-payment for accumulated operator rewards
- `slashNonceReuse(operator_id, signed_commitment_a, signed_commitment_b)` — lazy fraud proof
- `slashNonAcknowledgment(session_id, operator_id)` — VRF-selected operator missed ack window
- `slashSessionAbandonment(verifier_address, agent_pubkey, session_ids[])` — 3+ expired sessions in 60 min
- `slashBadShare(operator_id, wire_payload, sig, decrypted_share, recipient_index)` — authenticated invalid DKG share
- `slashEquivocation(operator_id, session_id, signed_payload, bytes32(0))` — off-session co-signing

**SuccessionRegistry:**
- `commitSuccession(commitment)` — Phase 1 of succession
- `revealSuccession(agent_id, old_pubkey, new_pubkey, salt)` — Phase 2 (after 24h)
- `vetoSuccession(agent_id)` — guardian cancels pending commitment
- `initiateSuccessionWithEndorsement(agent_id, new_group_pubkey, new_control_pubkey, timestamp, threshold_signature)` — bypass stolen control key
- `commitControlKeyRotation(commitment)` — standalone control key rotation
- `revealControlKeyRotation(agent_id, old_control_pubkey, new_control_pubkey, salt, threshold_signature)` — after 24h
- `rotateGuardianWithEndorsement(agent_id, new_guardian, timestamp, threshold_signature)` — emergency guardian rotation

**ServiceManager:**
- `registerOperator()` — register with stake verification
- `authorizeResharing(agent_id, new_operator_set, new_K, new_N, timestamp, threshold_signature)` — authorize resharing

**DKGContract:**
- `ackShareReceived(epoch, sig)` — Phase 1 resharing acknowledgment
- `confirmResharing(epoch, sig)` — Phase 2 resharing confirmation
- `abortResharing(epoch)` — abort after 30-min timeout
- Events: `ResharingCompleted(epoch, timestamp, operator_set_hash)`, `ResharingAborted(epoch)`

### 11.3 Key Events

| Event | Contract | Trigger |
|-------|----------|---------|
| `SessionCreated` | SessionRegistry | `initSession` success |
| `SessionSpent` | SessionRegistry | `spendSession` success |
| `SuccessionCommitted` | SuccessionRegistry | `commitSuccession` success |
| `SuccessionVetoed` | SuccessionRegistry | `vetoSuccession` success |
| `SuccessionPublished` | SuccessionRegistry | `revealSuccession` success |
| `GuardianRotatedByEndorsement` | SuccessionRegistry | `rotateGuardianWithEndorsement` success |
| `ResharingCompleted` | DKGContract | All N `confirmResharing` received |
| `ResharingAborted` | DKGContract | Timeout + `abortResharing` called |
| `SlashDistributed` | All slash contracts | Any successful slash (includes watcher, treasury, burned amounts) |

### 11.4 Contract Safety Requirements

All contracts SHALL:

- Target Solidity 0.8+. No `unchecked` blocks in counter-tracking or balance-tracking code.
- Apply OpenZeppelin `ReentrancyGuard.nonReentrant` to all state-mutating functions.
- Use strict checks-effects-interactions ordering. `session.status = SPENT` SHALL be the first state write in `spendSession`, before any external call.
- Use pull-payment for all bond refunds and reward distributions. `spendSession` and slash functions SHALL NOT transfer ETH directly.
- Session status SHALL use a three-value enum `{ OPEN, SPENT, EXPIRED }` with lazy expiry evaluation.

Slash functions require cryptographically verifiable on-chain evidence. Any address may call them — the contract's evidence verification is the access control. No whitelist of authorized callers is maintained.

`slashSessionAbandonment` SHALL require `block.timestamp > session.createdAt + SESSION_EXPIRY + 60 seconds` (the 60-second buffer prevents validator timestamp manipulation near the expiry boundary).

Session expiry with `status: OPEN` SHALL NOT trigger any bond reduction. Expiry is not misbehavior.

---

## 12. Economic Model

### 12.1 Denomination

All fees, bonds, slashes, and rewards SHALL be denominated and settled in ETH. No protocol-specific token is used.

### 12.2 Operator Stake Tiers

| Tier | Minimum Stake | Applies When |
|------|--------------|--------------|
| **Baseline** | 50 ETH | All operators; covers agents with asset value ≤ $500k |
| **Financial** | 100 ETH | Operators serving agents declaring `minVerifierBond ≥ 0.5 ETH` |
| **High-value** | Baseline + supplemental bonding pool | Agents with assets above baseline coverage ceiling |

`ServiceManager.registerOperator()` SHALL revert if the operator's EigenLayer restaked balance does not meet the applicable tier minimum.

**Coverage ceiling formula:**

```
coverage_ceiling = K × operator_stake × max_slash_fraction / safety_margin
```

| Tier | Calculation | Approximate Ceiling (ETH = $3,000) |
|------|-------------|-------------------------------------|
| Baseline | 7 × 50 ETH × 100% / 2 = 175 ETH | ~$525,000 |
| Financial | 7 × 100 ETH × 100% / 2 = 350 ETH | ~$1,050,000 |

Agents with declared asset values above the coverage ceiling SHALL receive an explicit warning at bootstrap time.

### 12.3 Slash Calibration

All slash amounts are **compile-time constants** in the contract bytecode. No governance parameter, storage variable, or admin function controls slash amounts after deployment. Changing slash amounts requires a new contract deployment.

| Slashable Condition | Constant | Amount | Detection P | Calibration Basis |
|---------------------|----------|--------|-------------|-------------------|
| Nonce reuse | `SLASH_NONCE_REUSE` | 75 ETH | 0.95 | Marginal gain = $143k; 1.5× safety |
| Bad share / ceremony sabotage | `SLASH_BAD_SHARE` | 6 ETH | 0.90 | Gain = delay ~$10k |
| Non-acknowledgment of session | `SLASH_NON_ACKNOWLEDGMENT` | 0.1 ETH | 1.00 | Liveness failure; cumulative |
| Non-confirmation of resharing | `SLASH_NON_CONFIRMATION` | 5% of operator stake | 0.99 | Catastrophic if key lost |
| Missing deletion attestation (1st–2nd) | `SLASH_MISSING_DELETION_FIRST` | 1 ETH | 0.85 | Escalating deterrent |
| Missing deletion attestation (3rd+) | `SLASH_MISSING_DELETION_REPEAT` | 5 ETH | 0.85 | Escalating deterrent |
| Off-session co-signing (equivocation) | `SLASH_EQUIVOCATION` | 100% of operator stake | 0.60 | Maximum deterrent |
| Session abandonment (verifier) | `SLASH_ABANDONMENT` | 50% of verifier bond | 0.90 | Scales with bond tier |

`SLASH_NON_CONFIRMATION` and `SLASH_EQUIVOCATION` are applied as basis points of the operator's current staked balance at slash time, scaling with the operator's tier.

The contract maintains `missedDeletionCount[operator_id]` for escalation. A successful attestation resets the counter to zero.

### 12.4 Slash Proceeds Distribution

For every slash event, the recovered amount SHALL be distributed:

| Recipient | Share | Purpose |
|-----------|-------|---------|
| Slash proof submitter (watcher) | 20% | Incentivizes third-party monitoring |
| Protocol treasury | 30% | Funds development and insurance reserve |
| Burned (`address(0)`) | 50% | Deflationary; aligns with ETH monetary policy |

The watcher reward SHALL be transferred atomically in the slash transaction. The contract SHALL emit `SlashDistributed(slashee, watcher, watcherAmount, treasury, treasuryAmount, burned)`.

### 12.5 Fee Structure

**Bootstrap DKG Fee** (agent pays, one-time):

| Phase | Nominal Fee | Distribution |
|-------|-------------|-------------|
| L2 launch | ~$30 | 80% to N operators / 20% treasury |
| Growth phase | ~$200 | 80% to N operators / 20% treasury |

**Signing Session Fee** (verifier pays, per session):

| Phase | Target Fee | Distribution |
|-------|-----------|-------------|
| L2 post-ZK | $8–$12 | 70% operator pool / 20% treasury / 10% EigenLayer |
| Pre-ZK transitional | $30–$40 | Same split |

The session fee is deposited at `initSession` and held in escrow. On `spendSession`, the fee is distributed per the split above. On session expiry: 50% burned, 50% to operators who submitted valid `acknowledgeSession`.

**Resharing Fee** (agent pays): $50–$100 per event. Distribution: 80% operators / 20% treasury.

**Succession Fee** (agent pays): $20–$100 per event. Distribution: 80% to operators if signing required / 20% treasury.

### 12.6 Verifier Bond Tiers

| Tier | Bond Amount | Agent Declaration |
|------|------------|-------------------|
| **Floor** | 0.2 ETH | Default (no `minVerifierBond` declared) |
| **Standard** | 0.5 ETH | `minVerifierBond = 0.5 ETH` in AnchorIdentity |
| **High-value** | 2 ETH | `minVerifierBond = 2 ETH` |

Bonds are held in `SessionRegistry` escrow. Refundable in full on deregistration if no outstanding slash obligations exist. `initSession` SHALL verify `bondBalance[msg.sender] >= AnchorIdentity[agent_pubkey].minVerifierBond`.

### 12.7 Session Fee Distribution

```
Session fee (100%)
├── EigenLayer protocol fee:   10%   (via RewardCoordinator)
├── Protocol treasury:         20%
└── Operator pool:             70%
      └── Split equally among K acknowledging operators
```

Operator rewards accumulate in `SessionRegistry.operatorClaimable[operator_id]`. Operators withdraw via `claimOperatorBalance()`. Weekly, the protocol submits a Merkle reward root to EigenLayer's `RewardCoordinator` for integrated claiming.

### 12.8 Participation Rate

Operators SHALL achieve a minimum participation rate of **95%** of VRF-assigned sessions within a rolling 30-day epoch. An "assigned session" is one where the operator appears in the VRF-sampled K. A "participated session" is one where the operator submitted a valid `acknowledgeSession` within the 2-minute window.

Operators below 95% are excluded from that epoch's Merkle reward root (revenue exclusion, not deregistration). Operators below 95% for **3 consecutive epochs** SHALL be flagged for potential removal by protocol governance.

### 12.9 Cold-Start Programs

**Anchor Operator Program:**
- Guaranteed minimum: $2,000/operator/month for 12 months
- Maximum cohort: 9 anchor operators
- Total treasury commitment: $216,000

**Agent Bootstrap Subsidy:**
- First 1,000 agents receive gas rebate (agent pays $50 symbolic fee; treasury covers remaining gas)
- Total treasury commitment cap: $109,000

---

## 13. Security Properties

### 13.1 Guarantees

The protocol provides the following security properties, assuming honest operation of at least `N - K + 1` operators:

1. **No single point of key compromise.** The full private key never exists at any single location. Recovering it requires K independent key shares.
2. **Two-factor signing.** A valid group signature requires both the agent's control key authorization and K-of-N operator cooperation. Neither factor alone is sufficient.
3. **Replay prevention.** Session nonces are single-use. Signatures bind to `sha256(challenge || session_id)`. Spent sessions cannot be reused.
4. **Challenge integrity.** Operators verify `keccak256(raw_challenge)` membership in the on-chain committed set before generating nonce material. A compromised agent cannot redirect what is signed.
5. **Unpredictable operator selection.** VRF sampling uses `block.prevrandao` (beacon RANDAO), which is unpredictable until the block is produced. The verifier cannot grind nonces to pre-select favorable operators.
6. **Succession safety.** Commit-reveal with 24-hour timelock prevents frontrunning. Guardian veto provides an emergency brake. Append-only chain prevents modification.
7. **Economic deterrence.** Operator misbehavior is slashable. Slash amounts are calibrated so that `P(detection) × slash_amount > E[attacker_gain]` for each condition.
8. **Nonce reuse structural prevention.** The HKDF `info` field binding to `session_id || message_hash` makes identical nonce pairs across distinct signing contexts structurally impossible, independent of CSPRNG quality.

### 13.2 Threat Summary

| Threat | Attack | Mitigation |
|--------|--------|------------|
| Rogue key (DKG) | Malicious operator biases group key | Mandatory Schnorr PoK; verified by all peers before Round 2 |
| Nonce reuse | Operator reuses `(D_i, E_i)` across sessions | HKDF `info` binding (primary); `slashNonceReuse` (economic); nonce zeroing (defense-in-depth) |
| Share forgery (DKG) | Operator sends inconsistent shares | Feldman VSS with public commitments makes forgery infeasible; `slashBadShare` for authenticated invalid shares |
| Ephemeral key framing | MITM substitutes ephemeral key in Round 2 | Ed25519 signature covers full wire payload including ephemeral key |
| Agent message substitution | Compromised agent routes attacker payload to operators | Challenge hash pre-commitment in `initSession`; operator verifies membership before generating nonces |
| Succession frontrunning | Attacker observes `new_pubkey` in mempool | Commit-reveal hides `new_pubkey`; only committer can reveal |
| Succession injection | Attacker files fraudulent succession entry | 24-hour timelock; guardian veto; append-only chain |
| Control key theft | Attacker steals agent control key | Two-factor: still needs K operators; `initiateSuccessionWithEndorsement` for recovery; standalone control key rotation |
| Session monopolization | Verifier opens and abandons sessions | Per-verifier (10) and per-agent (N×2) session limits; `slashSessionAbandonment` at 3+ expired in 60 min |
| Operator collusion | K operators collude | N ≥ 10 minimum; concentration limit `N-K` per address; economic deterrence via stake |
| Reentrancy | Malicious contract re-enters SessionRegistry | `ReentrancyGuard`; CEI ordering; pull-payment pattern |
| Counter overflow | Arithmetic overflow in session counters | Solidity 0.8+ checked arithmetic; no `unchecked` in counter paths |
| Operator liveness failure | Operator misses acknowledgment window | `slashNonAcknowledgment`; 95% participation threshold for reward eligibility |

### 13.3 Key Assumptions

- The Ethereum beacon chain provides unpredictable `prevrandao` values.
- EigenLayer's slashing mechanism correctly executes slash transactions.
- Ed25519 discrete log is computationally infeasible.
- The CSPRNG used by operators produces unpredictable output (HKDF binding provides structural defense even if this assumption partially fails).
- At least `N - K + 1` operators are honest and independently operated.
- EigenDA maintains data availability for identity records.

---

## 14. Conformance Requirements

An implementation is conformant to this specification if it satisfies the applicable requirements for its role. Requirements use RFC 2119 keywords as defined in Section 3.

### 14.1 Agent Deployer Conformance

An agent deployer implementation:

1. SHALL generate a fresh Ed25519 control key pair at bootstrap. The control private key SHALL NOT be transmitted to any party.
2. SHALL read the on-chain operator registry to discover operator endpoints and public keys.
3. SHALL drive the FROST DKG ceremony per Section 7, relaying messages between operators without participating in key material.
4. SHALL produce the `db_commitment` via a FROST threshold signature over `sha256(agent_id || threshold_pubkey || control_pubkey)`.
5. SHALL write the identity record to EigenDA and anchor it on-chain via `AnchorIdentity`.
6. SHALL include an authorization token `sign(session_id || message_hash || token_nonce, control_privkey)` with every signing request, using a fresh `token_nonce` per request.
7. SHALL compute VRF operator sampling per Section 8.1 using only on-chain data.
8. SHALL verify assembled signatures locally via `ed25519.verify` before accepting them.
9. SHALL attempt to archive signed nonce commitments to EigenDA after each signing round.
10. SHOULD display the coverage ceiling at bootstrap and warn when agent value exceeds it.
11. SHALL NOT use N < 10 for production deployments.

### 14.2 Operator Conformance

An operator implementation:

1. SHALL register on-chain with an AVS Ed25519 public key, X25519 public key (with Proof of Possession), HTTPS endpoint URL, and sufficient staked ETH for the applicable tier.
2. SHALL store key shares in secure, persistent storage. Shares SHALL NOT be transmitted post-DKG.
3. SHALL verify all N-1 PoK proofs in DKG Round 1 before computing or sending any Round 2 material.
4. SHALL encrypt Round 2 shares using FROST-SHARE-ECIES-v1 with a fresh ephemeral X25519 scalar per transmission.
5. SHALL sign nonce commitments with the AVS Ed25519 key, covering `{ session_id, round_index, epoch, D_i, E_i, timestamp }`.
6. SHALL derive nonces using the RFC 9591 hybrid HKDF scheme per Section 8.3.
7. SHALL overwrite nonce scalar bytes with zeros immediately after computing the partial signature.
8. SHALL perform all 7 pre-checks (Section 8.3) before generating nonce material. SHALL emit a signed rejection receipt on failure.
9. SHALL submit `acknowledgeSession` within 2 minutes of session creation for VRF-assigned sessions.
10. SHALL submit `confirmResharing` within 30 minutes of receiving a valid Phase 1 share.
11. SHALL submit deletion attestations within 24 hours of `ResharingCompleted`.
12. SHALL enforce a per-agent signing rate limit of 60 requests per hour.
13. SHALL enforce a connection-level rate limit rejecting excess requests before cryptographic verification.
14. SHALL verify VRF selection membership before participating in a signing request.
15. SHALL discard nonce material for sessions that no longer exist on-chain.
16. SHALL NOT participate in signing for sessions not registered in `SessionRegistry`.

### 14.3 Verifier Conformance

A verifier implementation:

1. SHALL register on-chain with a staked bond meeting or exceeding the target agent's declared `minVerifierBond`.
2. SHALL commit challenge hashes in `initSession` before sending raw challenges to the agent.
3. SHALL NOT send raw challenges until the `initSession` transaction is confirmed on-chain.
4. SHALL verify all 5 returned signatures against the agent's on-chain public key before spending.
5. SHALL call `spendSession` with all 5 valid signatures atomically.
6. SHALL cache agent public keys for at most 5 minutes.
7. SHOULD subscribe to `SuccessionPublished` events for low-latency cache invalidation.
8. SHALL wait for 6-block finality before treating a `SuccessionPublished` event as final.
9. SHOULD poll `eth_getLogs` every 60 seconds as a fallback under WebSocket outage.
10. SHALL walk the succession chain from the genesis anchor to resolve the current active key.
11. SHALL reject succession chains containing cycles.

### 14.4 AVS Contract Conformance

The on-chain contracts:

1. SHALL target Solidity 0.8+ with no `unchecked` blocks in counter or balance paths.
2. SHALL apply `ReentrancyGuard.nonReentrant` to all state-mutating functions.
3. SHALL use checks-effects-interactions ordering in all state-mutating functions.
4. SHALL use pull-payment for all bond refunds and reward distributions.
5. SHALL represent session status as a three-value enum `{ OPEN, SPENT, EXPIRED }`.
6. SHALL enforce all slash amounts as compile-time constants.
7. SHALL distribute slash proceeds as 20% watcher / 30% treasury / 50% burned.
8. SHALL verify VRF membership on-chain for `slashNonAcknowledgment` without requiring off-chain proofs.
9. SHALL require cryptographically verifiable evidence for all slash functions. Caller identity SHALL NOT be a factor.
10. SHALL enforce operator concentration limits (`N - K` max seats per address) at `DKGInit`.
11. SHALL reject `group_pubkey` equal to the identity point in `AnchorIdentity`.
12. SHALL snapshot `control_pubkey` from `AnchorIdentity` into the session record at `initSession` time.
13. SHALL store `block.prevrandao` as `session.vrf_randao` for on-chain VRF verification.
14. SHALL enforce per-verifier (10) and per-agent (N × 2) open session limits.
15. SHALL enforce the `slashSessionAbandonment` 60-second `SLASH_BUFFER` after session expiry.

---

*End of specification.*
