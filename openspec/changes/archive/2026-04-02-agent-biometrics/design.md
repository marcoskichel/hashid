## Context

LLM agents currently have no native identity primitive. When an agent communicates with another agent or service, there is no way to verify that the responding model is the same model that was originally enrolled — it could be a different model, a prompt-injected impostor, or a fine-tuned clone.

This design establishes the prototype architecture for agent biometrics: a system where a model is fine-tuned on a cryptographically signed dataset such that its inference behavior becomes a verifiable identity signal, without the model holding any private key at runtime.

The prototype uses a centralized verifier (simpler to build, easier to iterate on). Post-prototype issues #1–#6 track the migration to P2P, IPFS storage, LoRA adapters, SSS key ceremony, and Layer B fingerprinting.

## Goals / Non-Goals

**Goals:**
- Define and implement the `hashid bootstrap` flow: keypair → challenge dataset → fine-tuning → identity record → key destruction
- Define and implement the `hashid verify` challenge-response protocol
- Implement a centralized verifier service that holds the challenge_db and scores responses
- Establish the similarity scoring approach (mean across X=5 challenges, threshold acceptance)
- Prove the core hypothesis: a fine-tuned model can approximate its training signatures well enough to be distinguishable from other models

**Non-Goals:**
- P2P verification (post-prototype issue #3)
- IPFS storage and succession chains (post-prototype issue #2)
- LoRA adapter instead of full fine-tune (post-prototype issue #4)
- SSS key destruction ceremony (post-prototype issue #1)
- Layer B error fingerprint (post-prototype issue #6)
- Challenge rate limiting (post-prototype issue #5)

## Decisions

### D1: Ed25519 for db_commitment only (signing primitive pivot)

**Decision**: Ed25519 is retained exclusively for signing `db_commitment = sign(sha256(challenge_db), privateKey)`. It is NOT used to generate individual challenge entries. The model output at temperature=0 (greedy decoding) is the identity signal for each challenge — not a cryptographic signature.

**Spike result**: Mean Hamming similarity = 0.4982 (std = 0.0230, min = 0.4434, max = 0.5566) on 100 held-out challenges after 1 epoch of fine-tuning on 1,000 pairs. This is indistinguishable from random (theoretical random baseline = 0.5000). Ed25519 is a cryptographic PRF with the avalanche property by design — no amount of training data overcomes this.

**HMAC-SHA256 evaluated and rejected**: Also a cryptographic PRF. Output size reduction does not improve learnability — the avalanche property holds regardless of output size. Expected result would be identical (~0.5 similarity). Rejected without further spiking.

**Rationale for pivot**: Any function that is verifiable from a public key alone requires a one-way trapdoor function, which is by definition computationally hard to approximate. LLM learnability and public-key verifiability are mutually exclusive under standard cryptographic assumptions. The prototype's centralized verifier already holds the challenge_db — individual challenge entries do not need to be independently verifiable from the public key. Ed25519 remains for db_commitment to authenticate the database as a whole.

**Future direction**: The production architecture (tracked separately) replaces the per-agent challenge_db with a universal genesis corpus. Individual challenge outputs are model-generated (temperature=0, greedy) and stored in a decentralized shard network. See design decision D8.

### D2: Full fine-tune for prototype, LoRA for production

**Decision**: Use full fine-tuning for the prototype via `unsloth` or `axolotl`.

**Rationale**: Simplest to implement and reason about. The prototype goal is to validate the hypothesis (can a model learn to approximate signatures?), not to optimize the training pipeline. LoRA is the right production path (post-prototype issue #4) but adds adapter management complexity.

**Alternative considered**: LoRA from the start. Rejected for prototype because it requires converting back to GGUF for Ollama compatibility, adding a step before the core hypothesis is validated.

### D3: Centralized verifier for prototype

**Decision**: A single verifier service holds the challenge_db and performs scoring.

**Rationale**: Eliminates the complexity of IPFS publishing, TOFU session management, and peer discovery during the prototype phase. The challenge_db is just a local file the verifier service reads.

**Alternative considered**: P2P from day one. Rejected — too much infrastructure before the biometric hypothesis is proven.

### D4: X=5 challenges per verification session

**Decision**: Each verification session issues 5 challenges.

**Rationale**: Minimum batch size for a basic similarity distribution check. At 200k total challenges, this supports 40,000 verification sessions. Provides 5 independent data points per session — enough to compute mean and detect gross anomalies. Can be increased in production without protocol changes.

### D5: Challenge strings include a timestamp seed

**Decision**: Challenge strings are generated with an embedded time seed: `hashid_{epoch_bucket}_{index}_{random}`.

**Rationale**: Forces the model to generalize (it cannot memorize exact strings since challenges include time components), and the epoch_bucket provides coarse replay resistance. The verifier validates that the epoch_bucket in a challenge matches its issuance window.

### D6: Similarity metric — normalized bit-level Hamming distance

**Decision**: `similarity = 1 - (hamming_distance(predicted, real) / total_bits)`

**Rationale**: Directly measures bit-level accuracy of the model's output. Ed25519 signatures are 512 bits (64 bytes). A random guess scores ~0.50; a perfect match scores 1.0. The model is expected to score 0.80–0.92 based on analogous sequence learning tasks. Threshold set at 0.78 for prototype (conservative, to be tuned against actual training results).

**Alternative considered**: Levenshtein distance on hex-encoded strings. Rejected — operates at character level, less precise for binary data.

### D7: Key destruction via signed death certificate

**Decision**: The private key's last act is signing `{ destroyed: true, db_commitment, timestamp }`. The resulting death certificate is stored alongside the identity record.

**Rationale**: Social proof via an auditable, open-source tool. Not cryptographic proof of destruction (that requires SSS ceremony, post-prototype issue #1), but establishes a clear audit trail for the prototype.

## Risks / Trade-offs

**[Risk] Model cannot learn to approximate Ed25519** → The avalanche property of Ed25519 means inputs with small differences produce completely different outputs. The model may only memorize training pairs without generalizing.
Mitigation: Validate hypothesis in a spike before committing to the full training pipeline. If Ed25519 proves unlearnable, fall back to HMAC-SHA256 which has smoother output properties.

**[Risk] Similarity threshold too high** → Model fails verification even though it is the authentic agent.
Mitigation: Threshold (0.78) is set conservatively. Measure actual model accuracy on a held-out validation set during bootstrap and surface the observed mean/std in the identity record. Adjust threshold based on data.

**[Risk] Challenge farming during prototype** → No rate limiting in prototype; an attacker can collect many (challenge, approx_sig) pairs.
Mitigation: Acceptable for prototype. Rate limiting is tracked in post-prototype issue #5.

**[Risk] Key survives destruction** → Operator keeps a copy of the private key after bootstrap.
Mitigation: Acceptable for prototype (social proof model). SSS ceremony provides cryptographic guarantees in production (post-prototype issue #1). Notably: a key holder attempting to impersonate the model would produce similarity = 1.0, which is itself detectable as an anomaly.

## Migration Plan

Prototype → Production migration is tracked via GitHub issues #1–#6. Each issue is self-contained and can be implemented independently. Suggested order:
1. Issue #4 (LoRA) — biggest training UX improvement
2. Issue #2 (IPFS) — enables P2P
3. Issue #3 (P2P protocol) — depends on #2
4. Issue #6 (Layer B fingerprint) — depends on #3 for TOFU history
5. Issue #1 (SSS ceremony) — final security hardening
6. Issue #5 (rate limiting) — can be done at any point

## Open Questions

- **Can Ed25519 actually be learned?** ~~Must be validated in a spike.~~ **Answered: No.** Spike result = 0.4982 similarity (random). HMAC-SHA256 also rejected. Signing primitive pivoted — see D1.
- **What base model?** `llama3.2:3b` is the working assumption. Needs empirical validation against the new learnable function approach (tracked in genesis-shard-network change).
- **How many training epochs?** Unknown until new spike with learnable function.
- **Optimal threshold?** 0.78 is a placeholder. Must be derived from actual results under the new approach.
