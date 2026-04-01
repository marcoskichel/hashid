## 1. Hypothesis Spike

- [x] 1.1 Write a standalone script that generates 1,000 (challenge, Ed25519 signature) pairs and fine-tunes a small model (llama3.2:1b or similar) for 1 epoch
- [ ] 1.2 Run inference on 100 held-out challenges and compute mean Hamming similarity
- [ ] 1.3 Record results: if mean similarity < 0.70, evaluate HMAC-SHA256 as fallback signing primitive
- [ ] 1.4 Decide go/no-go on Ed25519 based on spike results and document the decision in design.md

## 2. Project Scaffolding

- [x] 2.1 Create `packages/hashid-cli` with TypeScript setup, `package.json`, and `tsconfig.json`
- [x] 2.2 Create `apps/verifier` with TypeScript setup and `package.json`
- [x] 2.3 Add both packages to `pnpm-workspace.yaml` and `turbo.json`
- [x] 2.4 Add `@noble/ed25519` to `hashid-cli` for keypair generation and signing

## 3. Challenge Database Generator

- [x] 3.1 Implement `generateKeypair()` — Ed25519 keypair, private key in memory only
- [x] 3.2 Implement `generateChallengeString(epochBucket, index)` — format: `hashid_{epoch_bucket}_{index}_{random8hex}`
- [x] 3.3 Implement `signChallenge(challenge, privateKey)` — returns 64-byte hex signature
- [x] 3.4 Implement `generateChallengeDb(count, privateKey)` — produces 200,000 entries
- [x] 3.5 Implement `computeDbCommitment(challengeDb, privateKey)` — `sign(sha256(serialized_db), privateKey)`
- [x] 3.6 Write unit tests for challenge format, uniqueness, signature validity, and db_commitment verification

## 4. Bootstrap CLI Command

- [x] 4.1 Implement `hashid bootstrap --model <name> --output <dir>` CLI entry point
- [x] 4.2 Wire keypair generation → challenge db generation → commitment computation in sequence
- [x] 4.3 Integrate fine-tuning step: invoke Python training script (unsloth/axolotl) as a subprocess with challenge db as input
- [x] 4.4 Implement bootstrap validation: run 500 held-out challenges through fine-tuned model, compute mean similarity and std dev
- [x] 4.5 Halt bootstrap if mean similarity < 0.70, log failure with observed score
- [x] 4.6 Implement death certificate signing: `sign({ destroyed: true, db_commitment, timestamp }, privateKey)`
- [x] 4.7 Zero private key bytes from memory after death certificate is produced
- [x] 4.8 Write identity record to `<output>/identity.json` with all required fields
- [x] 4.9 Write challenge db to `<output>/challenge_db.json`
- [x] 4.10 Write integration test: run bootstrap end-to-end on a tiny dataset (100 challenges, 1 epoch) and assert identity record is valid

## 5. Fine-tuning Pipeline

- [x] 5.1 Create Python training script `packages/hashid-cli/scripts/train.py` using unsloth or axolotl
- [x] 5.2 Script accepts: `--model`, `--challenge-db-path`, `--output-path`, `--epochs`
- [x] 5.3 Script outputs fine-tuned model weights to `--output-path` in a format loadable by Ollama
- [ ] 5.4 Add instructions to README for setting up Python venv and installing training dependencies
- [ ] 5.5 Test training script standalone with small challenge set

## 6. Verifier Service

- [x] 6.1 Implement `loadIdentityRecord(path)` — loads and validates identity record; verifies db_commitment against public key
- [x] 6.2 Implement `loadChallengeDb(path)` — loads challenge db, tracks spent challenges in memory
- [x] 6.3 Implement `selectChallenges(count)` — selects `count` unspent challenges at random
- [x] 6.4 Implement `computeSimilarity(predicted, real)` — normalized Hamming distance on 64-byte arrays
- [x] 6.5 Implement `scoreSession(responses, challenges)` — mean similarity across all challenge pairs
- [x] 6.6 Implement `POST /session/start` — generates session nonce, selects 5 challenges, returns both; sets 30s session expiry
- [x] 6.7 Implement `POST /session/verify` — validates nonce, scores responses, spends challenges on acceptance, returns `{ verified, score, session_id }`
- [x] 6.8 Implement session expiry: background job that returns expired session challenges to unspent pool
- [x] 6.9 Write unit tests for similarity computation, session scoring, nonce validation, and challenge spending logic
- [x] 6.10 Write integration test: full session flow from `/session/start` through `/session/verify` with a mock agent

## 7. Verify CLI Command

- [x] 7.1 Implement `hashid verify --agent <identity-record-path> --verifier <verifier-url>` CLI command
- [x] 7.2 Command calls `/session/start`, sends challenges to the local agent model, submits responses to `/session/verify`
- [x] 7.3 Print result: `verified: true/false`, score, and threshold
- [ ] 7.4 Write end-to-end test: bootstrap a tiny model, run verify, assert result is returned

## 8. Docker & Local Dev

- [ ] 8.1 Add verifier service to `docker-compose.yml` with volume mount for identity record and challenge db
- [ ] 8.2 Document the full local flow in `apps/verifier/README.md`: bootstrap → run verifier → run verify command
