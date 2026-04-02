## Why

LLM agents have no native identity — any agent can impersonate any other without a cryptographic foundation to distinguish them. This change introduces agent biometrics: a mechanism that allows a model to develop a unique, unforgeable signing behavior derived from a private key, without ever holding that key at runtime.

## What Changes

- Introduce a `hashid bootstrap` CLI tool that generates a keypair, produces a challenge signing dataset, fine-tunes a model on that dataset, publishes an identity record, and destroys the private key
- Introduce a `hashid verify` CLI command that runs a biometric challenge-response session against an agent
- Define the challenge-response protocol: verifier issues X challenge strings, agent returns approximate signatures, verifier scores similarity against stored ground-truth signatures
- Introduce a centralized verifier service (prototype) that holds the challenge database and tracks spent challenges
- Define the identity record format: `{ public_key, challenge_db, db_commitment, layer_a_profile }`
- Define the similarity scoring approach: mean similarity across X=5 challenges with threshold-based acceptance

## Capabilities

### New Capabilities

- `bootstrap`: CLI workflow to generate a keypair, produce and sign 200k challenge strings, fine-tune a model, validate the biometric, publish the identity record, and destroy the private key
- `verification-protocol`: Challenge-response protocol between a verifier and an agent — session nonce for liveness, X=5 challenge batch for identity, similarity scoring with threshold acceptance
- `identity-record`: The published artifact that anchors an agent's identity — contains public key, challenge database, db_commitment, and Layer A similarity profile
- `challenge-db`: The 200k (challenge_string, real_signature) pairs generated at training time and used as verification material

### Modified Capabilities

## Impact

- New CLI package (`packages/hashid-cli`) with `bootstrap` and `verify` commands
- New server package (`apps/verifier`) — centralized verifier service for the prototype phase
- Fine-tuning pipeline dependency: `unsloth` (Python) or equivalent for LoRA-based training
- Crypto dependency: `@noble/ed25519` or `libsodium` for keypair generation and signing
- Storage: local filesystem for prototype (challenge_db as JSON/binary); IPFS migration tracked in post-prototype issue #2
