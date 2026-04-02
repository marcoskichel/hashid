## 1. Learnability Spike (gate — no implementation until this passes)

- [x] 1.1 Write `packages/hashid-cli/scripts/spike2.py`: fine-tune two models independently on same 1,000-entry genesis corpus subset (different seeds), run inference on 100 held-out entries at temperature=0, compute Hamming similarity for authentic vs stored and different-model vs stored
- [ ] 1.2 Run spike and record results: authentic similarity, different-model similarity, signal gap
- [ ] 1.3 Evaluate go/no-go: gap ≥ 0.30 = go, < 0.20 = no-go, 0.20–0.30 = inconclusive (try next candidate)
- [ ] 1.4 If go: document confirmed model/quantization config in design.md and set final similarity thresholds

## 2. Genesis Corpus

- [ ] 2.1 Agree on and document the global seed (e.g., SHA256 of a well-known public block hash); commit to `openspec/changes/genesis-shard-network/genesis-seed.md`
- [ ] 2.2 Implement `packages/hashid-cli/scripts/generate_corpus.py`: generates 100,000 challenge strings from global seed using `hashid_{epoch_bucket}_{index}_{sha256(seed||index)[0:8]}` format
- [ ] 2.3 Generate and publish the corpus; record corpus CID/location in genesis-seed.md
- [ ] 2.4 Write unit tests: corpus is reproducible from seed, format is correct, 100k entries

## 3. Bootstrap Flow Changes

- [ ] 3.1 Update `packages/hashid-cli/scripts/train.py`: accept `--genesis-corpus-path` instead of `--challenge-db-path`; training uses corpus entries as input
- [ ] 3.2 Implement shard upload step in `packages/hashid-cli/scripts/upload_shards.py`: runs inference on all corpus entries at temperature=0, computes shard addresses, uploads to shard network
- [ ] 3.3 Update `packages/hashid-cli/src/bootstrap/bootstrap.ts`: remove `challenge_db.json` generation; add shard upload step after training; record corpus version in identity record
- [ ] 3.4 Update `packages/hashid-cli/src/bootstrap/types.ts`: add `corpusVersion` field to `IdentityRecord`; remove `challengeDbPath`
- [ ] 3.5 Update bootstrap integration test: mock shard upload, assert identity record contains corpus version and db_commitment over uploaded outputs
- [ ] 3.6 Update `packages/hashid-cli/README.md`: document new bootstrap flow and shard upload step

## 4. Shard Network Client

- [ ] 4.1 Implement `packages/hashid-cli/src/shard-network/address.ts`: `computeShardAddress(agentPubkey, shardIndex, epochBucket)` using sha256
- [ ] 4.2 Implement `packages/hashid-cli/src/shard-network/client.ts`: `uploadShard(address, output)` and `fetchShard(address)` using libp2p DHT
- [ ] 4.3 Implement `apps/verifier/src/shard-network/client.ts`: `fetchShard(agentPubkey, shardIndex)` — computes address, fetches from network, returns stored output
- [ ] 4.4 Write unit tests for address derivation: same inputs → same address, different epoch → different address, output is 32-byte hex
- [ ] 4.5 Write integration tests for shard upload/fetch round-trip against a local libp2p test network

## 5. Verifier Service Changes

- [ ] 5.1 Replace `apps/verifier/src/challenge-db/` with `apps/verifier/src/lib/genesis-corpus.ts`: loads corpus by version, returns challenge string for a given index
- [ ] 5.2 Update `apps/verifier/src/lib/session.ts`: `startSession` now selects 5 random corpus indices, computes shard addresses, fetches stored outputs from shard network, returns challenge strings only (not stored outputs)
- [ ] 5.3 Update `apps/verifier/src/lib/session.ts`: `verifySession` scores agent outputs against the stored shard outputs retrieved in `startSession`; stored outputs are held in session state, not re-fetched
- [ ] 5.4 Update `apps/verifier/src/state.ts`: remove `challengeDb` field; add `shardNetworkClient` and `genesisCorpus`
- [ ] 5.5 Update `apps/verifier/src/index.ts`: remove `CHALLENGE_DB_PATH` env var; add `CORPUS_VERSION` and shard network config
- [ ] 5.6 Update verifier session unit tests: mock shard network client, assert challenges sent to agent do not include stored outputs
- [ ] 5.7 Update verifier integration test: full session flow using mocked shard network

## 6. CLI Verify Command Changes

- [ ] 6.1 Update `packages/hashid-cli/src/verify/verify.ts`: no functional change to CLI interface; verify the underlying verifier client still works with updated session protocol
- [ ] 6.2 Update `packages/hashid-cli/src/verify/__tests__/verify.test.ts`: update mocks to reflect new session structure (no stored outputs in challenge response)

## 7. GitHub Issues Update

- [ ] 7.1 Update issue #2 (IPFS succession): note that challenge_db storage is superseded by shard network; IPFS may still apply to identity record storage and succession chain
- [ ] 7.2 Update issue #3 (P2P verification): update verification flow description to reflect verifier-driven shard pulls and genesis corpus

## 8. Documentation

- [ ] 8.1 Update `apps/verifier/README.md`: new bootstrap → shard upload → verify flow
- [ ] 8.2 Add `packages/hashid-cli/README.md` section on genesis corpus setup and shard upload
