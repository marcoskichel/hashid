## Why

The prototype proved that Ed25519 signatures are unlearnable by LLMs (spike result: 0.4982 similarity ≈ random). The biometric signal must shift from "model approximates a cryptographic function" to "model produces consistent, identity-unique outputs for a shared challenge corpus." The centralized verifier holding a private per-agent challenge_db also blocks trustless P2P verification — the database must become shared infrastructure, not a secret held by one party.

## What Changes

- **Replace per-agent challenge_db** with a universal genesis corpus — a large, fixed set of challenge strings shared by all agents. Each agent's identity is its model's outputs for those challenges, not the challenges themselves.
- **Replace centralized verifier db** with a decentralized shard network. Agent outputs are sharded, addressed by `hash(agent_pubkey || shard_id || epoch)`, and stored across independent nodes. No single node holds enough to clone an agent.
- **Replace Ed25519 individual signatures** with model outputs at temperature=0 (greedy decoding). The model's learned behavior IS the signing function.
- **Enable P2P verification** — any peer with the agent's public key can discover shard addresses, pull 5 entries from the network, and score a verification session independently.
- **Add learnability spike** as a prerequisite gate — a new signing primitive (simpler keyed function) must be validated before any implementation work begins. No implementation proceeds until similarity >> 0.5 is confirmed.
- **BREAKING**: `challenge_db.json` format changes. Per-agent challenge databases are replaced by output shards stored on the network.
- **BREAKING**: Bootstrap flow changes. After fine-tuning, the operator immediately runs inference on all genesis corpus shards and uploads outputs to the network before shutting down the training session.
- **BREAKING**: Verification protocol changes. Verifier pulls shard entries from the network rather than reading a local file.

## Capabilities

### New Capabilities

- `genesis-corpus`: Universal, fixed challenge corpus shared by all agents. Defines the format, generation, and distribution of the X-million challenge strings that serve as inputs for all agent bootstraps.
- `shard-network`: Decentralized storage protocol for agent model outputs. Defines shard addressing (`hash(pubkey || shard_id || epoch)`), epoch rotation, storage node responsibilities, rate limiting, and Sybil-resistant verifier identity requirements.
- `learnability-spike`: Spike protocol for validating that a candidate signing primitive is learnable before committing to implementation. Defines success criteria (mean similarity threshold), output format, and go/no-go gate.

### Modified Capabilities

- `challenge-db`: Requirements change significantly — per-agent challenge_db is replaced by agent output shards keyed against the genesis corpus. Entry structure, storage location, and integrity check all change.
- `verification-protocol`: Verifier now pulls shard entries from the network rather than reading a local db. Session flow, challenge selection, and scoring mechanics are updated for the distributed model.

## Impact

- `packages/hashid-cli`: bootstrap command changes (shard upload step added after training), verify command unchanged in interface but underlying flow changes
- `apps/verifier`: shard network client replaces local challenge_db reads; session flow updated
- GitHub issues #2 (IPFS), #3 (P2P protocol): superseded by this change — shard network design replaces the IPFS succession approach for challenge storage
- GitHub issues #1 (SSS), #4 (LoRA), #5 (rate limiting), #6 (Layer B): unaffected, remain valid post-production concerns
- New Python spike script required before any TypeScript implementation
