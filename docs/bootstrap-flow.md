# Bootstrap Ceremony Flow

The bootstrap ceremony is the one-time process that establishes an agent's persistent cryptographic identity. It runs a Distributed Key Generation (DKG) protocol across a set of EigenLayer AVS operators using Feldman VSS, produces a threshold public key, anchors an identity record to EigenDA for data availability, and finalizes on-chain via the `AnchorIdentity` contract. After this ceremony completes, the agent holds no private key material — all shares are distributed across the operator set.

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Agent (hashid-cli)
    participant Op1 as AVS Operator 1
    participant OpN as AVS Operator N
    participant EigenDA as EigenDA
    participant Chain as Ethereum Chain (AnchorIdentity)

    Note over Agent,Chain: No private key ever exists on the agent machine. All shares are held by AVS operators.

    Agent->>Agent: Generate control key pair (Ed25519, agent machine only)
    Note over Agent: control_privkey stays local — never transmitted

    Agent->>Op1: DKGInit(session_id, K, N)
    Agent->>OpN: DKGInit(session_id, K, N)

    Note over Op1,OpN: Round 1 — Commitment + Proof of Knowledge Broadcast
    Op1->>Op1: Generate secret polynomial f1(x) of degree K-1
    Op1->>Op1: Compute Feldman VSS commitments C1[0..K-1]
    Op1->>Op1: Sample nonce k from CSPRNG
    Op1->>Op1: Compute R1 = k·G, c1 = HDKG(1 || C1[0] || R1), mu1 = k + a10·c1 mod q
    OpN->>OpN: Generate secret polynomial fN(x) of degree K-1
    OpN->>OpN: Compute Feldman VSS commitments CN[0..K-1]
    OpN->>OpN: Sample nonce k from CSPRNG
    OpN->>OpN: Compute RN = k·G, cN = HDKG(N || CN[0] || RN), muN = k + aN0·cN mod q
    Op1->>Agent: Broadcast VSS commitments (C1, sigma1)
    OpN->>Agent: Broadcast VSS commitments (CN, sigmaN)
    Agent->>Op1: Relay all peer commitments
    Agent->>OpN: Relay all peer commitments

    Note over Op1,OpN: PoK Verification — must pass before Round 2
    Op1->>Op1: For each peer l: verify Rl == mul·G - cl·Cl[0]
    OpN->>OpN: For each peer l: verify Rl == mul·G - cl·Cl[0]
    alt Any PoK fails
        Op1->>Agent: Complaint(invalid_pok, culprit=l)
        Note over Agent: Ceremony aborted — no Round 2 shares sent
    end

    Note over Op1,OpN: Round 2 — Encrypted Share Exchange
    Op1->>OpN: Encrypted share s1(j) for operator j
    OpN->>Op1: Encrypted share sN(i) for operator i
    Op1->>Op1: Decrypt received shares; verify against commitments
    OpN->>OpN: Decrypt received shares; verify against commitments

    alt VSS verification fails
        Op1->>Agent: Complaint(invalid_share, from=j)
        Note over Agent: Ceremony aborted — restart with new session_id
    end

    Note over Op1,OpN: Derive group public key (sum of commitment constant terms)
    Op1->>Op1: group_pubkey = sum(Ci[0] for all i)
    OpN->>OpN: group_pubkey = sum(Ci[0] for all i)

    Agent->>Op1: ConfirmGroupPubkey(session_id)?
    Agent->>OpN: ConfirmGroupPubkey(session_id)?
    Op1->>Agent: group_pubkey (confirmed)
    OpN->>Agent: group_pubkey (confirmed)
    Note over Agent: group_pubkey verified — all N operators agree

    Agent->>Agent: Build identity_record { agent_id, threshold_pubkey, control_pubkey, eigenda_record_id: null, successor: null }

    Note over Agent,Chain: Threshold signature over stable identity core — this IS the db_commitment
    Agent->>Op1: SigningRound1(session_id, sha256(agent_id || threshold_pubkey || control_pubkey))
    Agent->>OpN: SigningRound1(session_id, sha256(agent_id || threshold_pubkey || control_pubkey))
    Op1->>Agent: PartialSignature
    OpN->>Agent: PartialSignature
    Agent->>Agent: FROST aggregation → Assembled Ed25519 signature (= db_commitment)

    Agent->>EigenDA: Write(identity_record, db_commitment)
    EigenDA->>Agent: eigenda_record_id

    Agent->>Agent: Finalize identity_record with eigenda_record_id

    Agent->>Chain: AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment[, guardian_address])
    Chain->>Chain: Verify inputs; store anchor record
    Chain->>Agent: tx_confirmed

    Note over Agent,Chain: Bootstrap complete — identity anchored on-chain. guardian_address is optional (--guardian flag).
```

## Key Design Decisions

**No key material on the agent.** The DKG ceremony never assembles the full private key in any single location. Each operator holds one FROST key share, and the threshold `K` of them must cooperate to produce any signature. The agent machine is a coordination client only.

**Feldman VSS over plain Shamir.** Feldman commitments allow every operator to independently verify that the shares they receive are consistent with the committed polynomial. A single invalid share triggers an immediate abort rather than producing a silently corrupted key.

**Abort on complaint.** There is no dispute-resolution round. Any VSS complaint causes the entire session to abort. This keeps the protocol simple and eliminates the complexity of identifying and evicting a malicious participant mid-ceremony. The session is restarted with a fresh `session_id`.

**PoK prevents rogue key attack.** Each operator broadcasts a Schnorr proof-of-knowledge over their constant-term commitment before Round 2. Without this, a malicious operator could choose their commitment to bias the group public key to one they control. PoK verification is a hard gate — no Round 2 shares are sent until all N-1 proofs pass.

**Agent as router, not trust anchor.** The agent relays DKG messages between operators but does not participate in key material handling. All cryptographic verification happens on the operators. A compromised or misbehaving agent machine can stall the ceremony but cannot forge keys or shares.

**`db_commitment` is a threshold signature, not a hash.** The commitment is a FROST Ed25519 threshold signature over `sha256(agent_id || threshold_pubkey || control_pubkey)`. This proves the key holder endorsed the record — a plain hash would only prove data integrity. The three hash inputs are the stable identity core: `eigenda_record_id` is excluded (it is only known after the EigenDA write, and including it would be circular) and `successor` is excluded (it is legitimately mutable post-bootstrap). The identity record is written to EigenDA first so that `eigenda_record_id` is available at the time `AnchorIdentity` is called.

**Control key as mandatory signing gate.** The agent generates a single-party Ed25519 control key at bootstrap, separate from the FROST group key. Every subsequent signing request must include an authorization token signed by this control key. This creates a two-factor structure: K-of-N operator shares are one factor; the agent's control key is the other. Neither alone is sufficient to produce a signature.
