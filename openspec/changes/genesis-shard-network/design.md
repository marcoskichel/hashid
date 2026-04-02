## Context

The prototype biometric approach — fine-tuning a model to approximate Ed25519 signatures — was invalidated by a spike (mean similarity 0.4982, indistinguishable from random). The fundamental incompatibility: any function verifiable from a public key alone requires a one-way trapdoor function, which is computationally hard to approximate by design.

This design replaces the cryptographic signing approach with a behavioral fingerprinting approach: the model's own outputs at temperature=0 (greedy decoding) serve as the identity signal. The challenge_db becomes a universal genesis corpus shared by all agents, and per-agent outputs are stored in a decentralized shard network rather than a private file held by a trusted verifier.

The learnability spike is a hard prerequisite gate. No implementation proceeds until the spike confirms that fine-tuned model outputs are (a) stable across inference runs and (b) distinct between independently fine-tuned models.

## Goals / Non-Goals

**Goals:**
- Define the learnability spike and its success criteria (go/no-go gate)
- Design the genesis corpus: format, size, deterministic generation
- Design the shard network: addressing, epoch rotation, rate limiting, Sybil resistance
- Enable trustless P2P verification: any peer with the agent's pubkey can verify independently
- Define the updated bootstrap flow: shard upload happens immediately after fine-tuning
- Define the updated verification flow: verifier-driven, pulls from shard network

**Non-Goals:**
- SSS key ceremony (issue #1)
- LoRA adapter format (issue #4) — assumed as the model storage format but not specified here
- Layer B error fingerprinting (issue #6)
- Full smart contract implementation for Sybil resistance (design decision made, implementation deferred)
- Registry design for agent pubkey discovery

## Decisions

### D1: Learnability spike as a hard gate

**Decision**: Before any implementation, run a spike to confirm that fine-tuned model outputs are usable as a biometric signal. The spike must demonstrate three properties: (1) stability — the same fine-tuned model produces the same output for the same challenge across runs at temperature=0; (2) distinctness — two independently fine-tuned models on the same corpus produce sufficiently different outputs; (3) signal gap — authentic model similarity to stored outputs is well above the similarity of a different model to those same outputs.

**Success criteria**: Authentic vs stored ≥ 0.90 mean similarity; different model vs stored ≤ 0.60 mean similarity. A gap of ≥ 0.30 is required. If the gap is below 0.20, the approach is considered unviable and a different signal must be explored.

**Rationale**: The prototype made the mistake of building the full pipeline before validating the core hypothesis. The spike prevents repeating that.

### D2: Genesis corpus — deterministic, fixed, public

**Decision**: The genesis corpus is a fixed set of 100,000 challenge strings, deterministically generated from a public seed using the same `hashid_{epoch_bucket}_{index}_{random8hex}` format as the prototype, but with `random8hex` derived from `sha256(global_seed || index)[0:4]` rather than true randomness. The global seed is a publicly agreed-upon value (e.g., the SHA256 of a well-known block hash at a documented height). Anyone can regenerate the corpus from the seed.

**Size rationale**: 100k entries balances bootstrap cost (run inference on all entries after training) against clone resistance. At 5 entries per verification session and rate limit of 10 sessions/hr, full corpus extraction requires 2,000 hours per verifier identity.

**Alternative considered**: True random per-agent challenge strings (original prototype). Rejected — requires distributing a private db per agent, which blocks trustless P2P verification.

### D3: Shard addressing — obfuscated by epoch

**Decision**: Shard storage address = `sha256(agent_pubkey || shard_index || epoch_bucket)[0:32]` where `epoch_bucket = floor(unix_timestamp / 86400)`. Addresses rotate daily. Storage nodes hold blobs at these addresses with no owner metadata — addresses appear random to nodes without the pubkey.

**Rationale**: Daily rotation means an attacker building a shard address map has a 24-hour window before it expires. Combined with rate limiting, systematic enumeration across multiple epochs is economically expensive. The pubkey requirement for address derivation means nodes cannot enumerate all shards for an agent without the pubkey.

**Alternative considered**: Static addresses (no epoch). Rejected — once an attacker has derived an address, it is valid forever. Epoch rotation forces repeated key derivation per epoch.

### D4: Decentralized network — libp2p DHT

**Decision**: Use a libp2p Kademlia DHT as the shard storage backend. Shard nodes are peers in the DHT that store and serve blobs at the computed addresses. Rate limiting is enforced at the application layer by nodes, keyed on verifier pubkey.

**Rationale**: libp2p is the underlying network stack for IPFS and is well-understood. The DHT provides content-addressed-style routing without requiring a central coordinator. It is operationally simpler than a blockchain-based solution while still being decentralized.

**Alternative considered**: Filecoin retrieval market. More suitable for large file storage with economic incentives; overhead is too high for the per-session, low-latency access pattern required here.

**Alternative considered**: Nostr relays. Simpler but relays are ephemeral and don't provide storage guarantees.

### D5: Verification flow — verifier-driven

**Decision**: The verifier independently computes 5 shard addresses (from agent pubkey + random indices + current epoch), fetches those shards from the network, then sends only the challenge strings to the agent. The agent runs inference and returns outputs. The agent has no involvement in shard retrieval and cannot observe the stored reference outputs.

**Rationale**: If the agent were involved in fetching shards, it could bias selection toward challenges it performs best on. The verifier-driven model ensures the agent is a pure black box during verification.

**Alternative considered**: Agent-brokered with encrypted shards (agent fetches, forwards encrypted blob to verifier). Rejected — the agent can still observe which challenge indices are being selected and potentially bias toward memorized entries.

### D6: Sybil resistance — staked verifier identities

**Decision**: Verifier identities are pubkeys registered on-chain with a stake deposit. Creating a verifier identity costs a fixed stake. Rate limits are applied per verifier identity. An attacker mounting a Sybil attack (many fake identities to bypass rate limits) must stake for each identity; the cost of extracting the full corpus is bounded below by `(corpus_size / (session_size * sessions_per_hour)) * identity_cost`.

**Stake and rate limit values are intentionally left as open questions** — they depend on the token economics and must be calibrated once the network is live.

**Alternative considered**: Proof-of-work per session. Simpler but variable cost and less amenable to governance adjustment.

### D7: Bootstrap shard upload — immediately after fine-tuning

**Decision**: The bootstrap ceremony runs inference on all 100k genesis corpus entries at temperature=0 immediately after fine-tuning, while the GPU is still warm and the model is loaded. Outputs are uploaded as shards to the network before the training session is torn down. The Ed25519 db_commitment (`sign(sha256(all_outputs_serialized), private_key)`) is computed and included in the identity record to anchor the published outputs to the keypair.

**Rationale**: Uploading immediately avoids a separate re-loading step (expensive GPU time) and ensures the operator cannot substitute different outputs post-training. Once uploaded and the private key is destroyed, the identity is sealed.

## Risks / Trade-offs

**[Risk] Spike fails — model outputs not sufficiently distinct** → Fine-tuned models may produce too-similar outputs regardless of training data. Mitigation: spike tests this explicitly before implementation. If gap < 0.20, explore different output representations (e.g., longer outputs, different prompt formats) before abandoning the approach.

**[Risk] Model weight extraction bypasses rate limiting** → If the LoRA adapter is extracted, an attacker can run inference locally on any genesis shard, bypassing the shard network entirely. Mitigation: LoRA adapter must remain private (never exposed via API, stored in secure enclave). This is the primary security assumption of the system.

**[Risk] Inference drift across hardware/quantization** → Same model on different hardware may produce slightly different outputs at the byte level even at temperature=0. Mitigation: the similarity threshold allows for small drift. Model version and quantization level must be pinned in the identity record and used consistently.

**[Risk] Genesis corpus becomes stale** → If the corpus is fixed forever, all agents eventually exhaust their unspent shards. Mitigation: corpus versioning — a v2 corpus can be published via the same deterministic generation process; agents re-bootstrap against the new corpus version using the succession chain.

**[Risk] Epoch rotation window** → During the epoch transition, verifiers computing addresses for the new epoch may not yet find shards (if the agent hasn't refreshed their shard addresses). Mitigation: shards are published for the current epoch + next epoch at bootstrap time, and re-published during a rolling window around epoch boundaries.

## Open Questions

- **What is the stake amount for verifier identity registration?** Depends on token economics; to be decided when the network is designed.
- **What base model and quantization?** Must be pinned per agent. Spike will use llama3.2:3b at 4-bit quantization as the first candidate.
- **How are shard nodes incentivised to store data?** Storage incentive design is out of scope for this change but required before network launch.
- **Exact similarity thresholds?** 0.90 / 0.60 gap criteria are spike targets, not final production values. Final thresholds to be derived from spike results.
