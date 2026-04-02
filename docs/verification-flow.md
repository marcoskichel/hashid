# Verification Flow

The verification flow is the runtime protocol that a third-party verifier uses to confirm that a given agent possesses the private key shares corresponding to an on-chain anchored identity. The verifier issues a set of challenge strings drawn from the agent's genesis corpus, the agent must produce threshold Ed25519 signatures over each one, and the verifier confirms validity both locally and on-chain. The session is finalized on-chain to prevent replay.

```mermaid
sequenceDiagram
    autonumber
    participant Verifier as Verifier App (apps/verifier, Hono)
    participant Chain as Ethereum Chain (SessionRegistry + AnchorIdentity)
    participant EigenDA as EigenDA
    participant Agent as Agent (hashid-cli / agent runtime)
    participant Coord as AVS Coordinator
    participant Ops as AVS Operators (K-of-N sampled)

    Note over Verifier,Chain: Pre-condition: verifier must be registered on-chain with a staked bond

    Verifier->>Chain: Check verifier registration (staked bond)
    Chain->>Verifier: registration confirmed

    Verifier->>Chain: Read eigenda_record_id from AnchorIdentity(agent_pubkey)
    Chain->>Verifier: eigenda_record_id, db_commitment

    Verifier->>EigenDA: Fetch identity record (eigenda_record_id)
    EigenDA->>Verifier: identity_record

    Verifier->>Verifier: Assert sha256(identity_record) == db_commitment

    Verifier->>Verifier: Select [c1..c5] from genesis corpus
    Verifier->>Verifier: Compute challenge_hashes = [keccak256(c1)..keccak256(c5)]
    Verifier->>Chain: initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)
    Chain->>Verifier: session_id (status: OPEN, challenge_hashes stored)

    Note over Verifier,Agent: 5-minute async signing window begins at session creation
    Verifier->>Agent: ChallengeRequest([c1, c2, c3, c4, c5], session_id)

    loop For each challenge ci (5 total)
        Agent->>Coord: RequestSignature({ challenge: ci, session_id }, session_id)

        Coord->>Chain: Verify session_id exists with status OPEN
        Chain->>Coord: session confirmed (OPEN)

        Coord->>Coord: VRF sample K operators from N registered operators

        Coord->>Ops: SigningRound1(session_id, message=sha256(ci || session_id))
        Ops->>Ops: Verify own staked balance >= AVS minimum
        Ops->>Ops: Verify VRF proof: vrf_verify(vrf_seed, vrf_proof) confirms this operator was legitimately sampled
        Ops->>Ops: Verify session_id on-chain
        Ops->>Ops: Verify keccak256(ci) in session.challenge_hashes
        Ops->>Ops: Verify sha256(ci || session_id) == message
        alt Pre-check fails
            Ops->>Coord: RejectionReceipt(session_id, message_hash, challenge_hash, round=1)
            Note over Ops: No nonce generated for uncommitted challenge
        end
        Ops->>Ops: Generate fresh nonce (D_i, E_i) using HKDF-SHA-512 hybrid scheme
        Ops->>Coord: NonceCommitment

        Coord->>Ops: SigningRound2(aggregated_nonce_commitment)
        Ops->>Ops: Compute partial signature using FROST protocol
        Ops->>Coord: PartialSignature

        Coord->>Coord: Collect K partial signatures; run FROST aggregation
        Coord->>Agent: Assembled Ed25519 signature (sig_i)

        Agent->>Agent: ed25519.verify(sig_i, sha256(ci || session_id), threshold_pubkey)
        Note over Agent: Agent rejects and retries if local verification fails
    end

    Agent->>Verifier: [sig1, sig2, sig3, sig4, sig5]

    loop For each (challenge ci, signature sig_i)
        Verifier->>Verifier: ed25519.verify(sig_i, sha256(ci || session_id), threshold_pubkey)
    end

    alt All 5 signatures valid
        Verifier->>Chain: SubmitVerification(session_id, [sig1..sig5])
        Chain->>Chain: Verify all 5 signatures; mark session SPENT
        Chain->>Verifier: tx_confirmed
        Verifier->>Verifier: Return { verified: true, session_id }
    else Any signature invalid
        Verifier->>Verifier: Return { verified: false, reason: "signature-invalid" }
        Note over Verifier,Chain: Session remains OPEN — verifier may retry within window
    end

    Note over Verifier,Chain: SPENT sessions cannot be reused — prevents replay attacks
```

## Key Design Decisions

**Verifier bond as spam prevention.** The verifier must stake a bond on-chain before initiating any session. This raises the cost of flooding the system with spurious sessions and ensures that `SessionRegistry` storage growth is economically bounded.

**5-minute async signing window.** The session remains in OPEN state for five minutes from creation. This window accommodates network latency and allows the agent to perform multiple signing rounds sequentially without the verifier needing to hold a synchronous connection open. If the window expires before submission, the session is automatically invalidated and a new one must be initiated.

**Retry behavior.** If the agent receives an assembled signature that fails local verification (e.g., due to a malformed partial share from a misbehaving operator), it can retry the signing round for that challenge while the session remains OPEN and within the five-minute window. The verifier does not need to be involved in retries — it simply waits for the full set of five signatures.

**VRF-based operator sampling.** The coordinator uses a verifiable random function to select the K signing operators for each challenge rather than using a fixed subset. This prevents targeted attacks where an adversary compromises a known fixed set. The VRF output is deterministic from the session seed, so the selection is auditable after the fact.

**`session_id` bound into the signed message.** Each signature covers `sha256(challenge || session_id)` rather than the raw challenge. This ensures that signatures produced for one session cannot be replayed into a different session even if the challenge strings happen to collide.

**SPENT state prevents replay.** Once a session is finalized on-chain as SPENT, no further submissions are accepted for that `session_id`. The nonce included in `initSession` ensures that two sessions for the same agent are always distinct, closing the replay vector at the protocol level.

**Agent verifies locally before returning.** The agent runs `ed25519.verify` on each assembled signature before returning to the verifier. This detects coordinator misbehavior or aggregation bugs early and avoids a round-trip to the verifier only to fail there.

**Challenge pre-commitment prevents coordinator message substitution.** The verifier commits to the exact challenge hashes in `initSession` before sending raw challenges. Operators verify the challenge is in the committed set before generating any nonce material. This closes the window where a compromised coordinator could route a different message to operators than what the verifier intended.

**Two-factor signing requirement.** Every signing request must include an authorization token from the agent's control key. Operators verify this token before generating any nonce material. This means neither K colluding operators nor a stolen control key alone can produce a valid signature — both factors are required.

**VRF proof verifiability.** The coordinator publishes a VRF proof alongside each operator selection. Operators verify the proof against the on-chain VRF seed before participating. A coordinator cannot silently bias operator selection — any deviation is detectable by the operators themselves.
