## 1. Package Conversion — hashid-cli to TypeScript

- [ ] 1.1 Delete `packages/hashid-cli` Python package structure (setup.py, pyproject.toml, __init__.py, all scripts)
- [ ] 1.2 Scaffold `packages/hashid-cli` as a TypeScript/Node.js package with package.json, tsconfig.json, and turbo pipeline entry
- [ ] 1.3 Add dependencies: `@noble/curves` (FROST Ed25519), EigenLayer AVS SDK, EigenDA client, commander (CLI framework)
- [ ] 1.4 Add vitest config and empty `__tests__/` directory

## 2. On-Chain Contracts

- [ ] 2.1 Write `SessionRegistry` Solidity contract: verifier registration with bond, `initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes: bytes32[5])` — snapshots `control_pubkey` from AnchorIdentity and stores `vrf_randao = block.prevrandao`; `spendSession(session_id, signatures[5])` — verifies exactly 5 Ed25519 signatures against committed challenge hashes, reverts if any missing or invalid; session expiry; per-verifier rate limit (max 10 open sessions); per-agent session rate limit (`N × 2` concurrent OPEN sessions); `acknowledgeSession(session_id, operator_id, sig)` within 2-minute window; `slashNonAcknowledgment(session_id, operator_id)` using on-chain VRF membership from stored `vrf_randao`; `slashSessionAbandonment(verifier_address, agent_pubkey, session_ids[])` for 3+ abandoned sessions within 60 minutes; `slashNonceReuse(operator_id, signed_commitment_a, signed_commitment_b)` with two operator-signed commitments
- [ ] 2.2 Write `AnchorIdentity` Solidity contract: store `(group_pubkey, control_pubkey, eigenda_record_id, db_commitment, guardian)` and succession chain entries
- [ ] 2.3 Write `SuccessionRegistry` Solidity contract: `commitSuccession(commitment)` — restricted to control key or registered guardian only; `revealSuccession(agent_id, old_pubkey, new_pubkey, salt)` with 24-hour timelock; `vetoSuccession(agent_id)` — checks guardian term validity at call time, reverts if guardian term expired; `initiateSuccessionWithEndorsement(agent_id, new_group_pubkey, new_control_pubkey, timestamp, threshold_signature)` — bypasses rate limit when control key stolen, supersedes pending attacker commitment, 24h timelock still applies; `authorizeResharing(agent_id, new_operator_set, new_K, new_N, timestamp, threshold_signature)`; succession rate limiting (1h min, 100 max chain length); guardian rotation via same commit-reveal path; `rotateGuardianWithEndorsement` for emergency guardian rotation; `slashNonConfirmation(operator_id, epoch, signed_share_receipt)` for Phase 2 resharing non-confirmation
- [ ] 2.4 Write unit tests for `SessionRegistry`: duplicate nonce, unregistered verifier, per-verifier rate limit, per-agent rate limit (`N × 2`), session spending with exactly 5 valid sigs, spending with fewer than 5 sigs reverts, spending with invalid sig reverts, expiry, challenge_hashes storage, control_pubkey snapshot, vrf_randao storage, acknowledgeSession within window, acknowledgeSession after window reverts, non-VRF-selected acknowledgment reverts, slashNonAcknowledgment for unacknowledged VRF operator, slashNonAcknowledgment rejected for acknowledged operator, slashSessionAbandonment with valid proof, slashSessionAbandonment with mixed verifiers reverts, slashNonceReuse with identical nonce pair, slashNonceReuse with same session+round reverts
- [ ] 2.5 Write unit tests for `AnchorIdentity`: group_pubkey + control_pubkey storage, both keys readable by operators, succession append-only, circular chain rejection
- [ ] 2.6 Write unit tests for `SuccessionRegistry`: commit restricted to control key or guardian, third-party commit reverts, commit records hash covering both key pairs, reveal before 24h reverts, reveal after 24h succeeds with both new keys, guardian veto cancels commitment, guardian veto reverts if guardian term expired, non-guardian veto reverts, rate limit (1h min, 100 max), guardian rotation, initiateSuccessionWithEndorsement supersedes pending commitment, initiateSuccessionWithEndorsement without valid threshold sig reverts, expired endorsement timestamp reverts, authorizeResharing accepted with valid threshold sig, DKGInit reverts without authorization, slashNonConfirmation with valid receipt, slashNonConfirmation reverts if confirmation exists
- [ ] 2.7 Deploy contracts to testnet; record addresses in config

## 3. FROST DKG Library (TypeScript)

- [ ] 3.1 Implement `initDkg(operators, threshold)` — broadcasts `DKGInit` to all N operators and collects Round 1 commitments
- [ ] 3.2 Implement Round 1 PoK generation: for each operator, sample nonce `k`, compute `R_i = k·G`, compute `c_i = HDKG(i || φ_{i0} || R_i)`, compute `μ_i = k + a_{i0}·c_i mod q`; broadcast `(C_i, σ_i)` together
- [ ] 3.3 Implement Round 1 PoK verification: before sending any Round 2 shares, verify every peer's proof `R_ℓ == μ_ℓ·G - c_ℓ·φ_{ℓ0}`; abort and broadcast culprit complaint on failure
- [ ] 3.4 Implement Round 2 share distribution: encrypt share per recipient, send point-to-point to each operator
- [ ] 3.5 Implement public key derivation: sum commitment constant terms; validate result is a valid Ed25519 point
- [ ] 3.6 Implement complaint handling: abort ceremony on invalid commitment or failed VSS share check
- [ ] 3.7 Write unit tests for DKG: successful 3-of-5 ceremony, PoK failure aborts before Round 2, complaint on bad share, abort on unresponsive operator

## 4. Threshold Signing Library (TypeScript)

- [ ] 4.1 Implement `requestSignature(message, sessionId)` — generate auth token `sign(session_id || message_hash, control_privkey)`, attach to request, compute VRF-sampled operator set using `keccak256(session_id || session.vrf_randao)` from on-chain session record, monitor on-chain acknowledgments before Round 1, broadcast, collect partial signatures
- [ ] 4.2 Implement operator auth token verification: `ed25519.verify(auth_token, session_id || message_hash || token_nonce, control_pubkey)` where `control_pubkey` is read from the session record (snapshotted at `initSession` time, not fetched live from AnchorIdentity); reject with receipt if absent or invalid; this check precedes all other operator checks
- [ ] 4.3 Implement operator Round 1 pre-check: verify `keccak256(raw_challenge) ∈ session.challenge_hashes` and `sha256(raw_challenge || session_id) == message`; emit signed rejection receipt and abort if either check fails
- [ ] 4.4 Implement RFC 9591 hybrid nonce derivation: `HKDF-SHA-512(IKM=share, salt=random_32, info="FROST-ED25519-SHA512-v1" || session_id || message_hash)`; zero `d_i` and `e_i` from memory immediately after partial signature is computed
- [ ] 4.5 Implement FROST partial signature aggregation — combine K partial signatures into final Ed25519 signature
- [ ] 4.6 Implement 5-minute async signing window with expiry and retry logic
- [ ] 4.7 Implement final signature verification before returning to caller: `ed25519.verify(sig, message, group_pubkey)`
- [ ] 4.8 Write unit tests: successful 3-of-5 signing, missing auth token rejected, invalid auth token rejected, replayed token nonce rejected, valid auth token proceeds, control_pubkey read from session record (not live AnchorIdentity), Round 1 pre-check rejects uncommitted challenge, Round 1 pre-check rejects malformed message, expiry + retry with new operator sample, non-sampled operator partial sig rejected, nonce scalars zeroed post-signing, final sig verification failure, nonce material discarded when session absent post-reorg, operator outside VRF set rejects acknowledgeSession

## 5. EigenDA Storage Client (TypeScript)

- [ ] 5.1 Implement `writeIdentityRecord(record)` — serialise to JSON, write to EigenDA, return `eigenda_record_id`
- [ ] 5.2 Implement `readIdentityRecord(eigendaRecordId)` — fetch from EigenDA, verify `sha256(record)` matches on-chain `db_commitment`
- [ ] 5.3 Write unit tests: write returns record ID, tampered record fails integrity check, missing record returns clear error

## 6. Bootstrap Command

- [ ] 6.1 Implement `hashid bootstrap` command entry point in TypeScript
- [ ] 6.2 Generate control key pair on agent machine; store control private key in secure local storage
- [ ] 6.3 Wire FROST DKG ceremony: call `initDkg`, collect group public key
- [ ] 6.4 Build identity record: `{ agent_id, threshold_pubkey, control_pubkey, eigenda_record_id: null, db_commitment: null }`
- [ ] 6.5 Compute `db_commitment` via threshold signing over `sha256(identity_record)` (includes auth token signed by control key)
- [ ] 6.6 Write identity record to EigenDA; update record with returned `eigenda_record_id`
- [ ] 6.7 Call `AnchorIdentity(group_pubkey, control_pubkey, eigenda_record_id, db_commitment[, guardian])` on-chain; wait for confirmation
- [ ] 6.8 Write integration test: bootstrap with mock AVS operators (3-of-5), verify both pubkeys are set in on-chain anchor

## 7. Verify Command

- [ ] 7.1 Implement `hashid verify` command entry point in TypeScript
- [ ] 7.2 Read agent identity record from EigenDA; verify `db_commitment` integrity
- [ ] 7.3 Fetch `threshold_pubkey` from on-chain anchor; walk succession chain to current active key
- [ ] 7.4 Select 5 arbitrary verifier-chosen challenge strings (e.g. random bytes or structured nonces); compute `keccak256(challenge)` for each to form `challenge_hashes: bytes32[5]`
- [ ] 7.5 Call `initSession(agent_pubkey, nonce, verifier_pubkey, challenge_hashes)` on-chain; wait for confirmation before sending raw challenges
- [ ] 7.6 Issue the 5 raw challenge strings to the agent after on-chain confirmation
- [ ] 7.7 Verify all 5 returned Ed25519 signatures against `threshold_pubkey`
- [ ] 7.8 On success: submit signatures on-chain to mark session SPENT; return `{ verified: true, session_id }`
- [ ] 7.9 Write integration test: full verify flow with mock agent and mock AVS (challenge hashing → session init → challenges → signatures → spend)

## 8. Key Succession

- [ ] 8.1 Implement `hashid rekey --reason <reason>` command for FROST resharing (no pubkey change)
- [ ] 8.2 Implement `hashid rotate` command for full keypair succession: new DKG + new control key pair → commit-reveal ceremony (commitment covers both key pairs) → 24h wait → reveal with old group-key signature → register new group_pubkey + control_pubkey atomically → invalidate old shares → destroy old control key
- [ ] 8.3 Implement guardian veto CLI helper: `hashid veto-succession <agent_id>` callable by the guardian address
- [ ] 8.4 Implement guardian registration in bootstrap: wire `--guardian` flag through to `AnchorIdentity` on-chain call
- [ ] 8.5 Implement agent-driven EigenDA archival of signed nonce commitments after Round 1: write full set of K operator-signed commitments `{ operator_id, session_id, round_index, epoch, D_i, E_i, timestamp, signature }` to EigenDA; record EigenDA record ID locally; signing is not blocked if archival fails
- [ ] 8.6 Implement `hashid rekey --authorize` step: collect K-of-N threshold endorsement for resharing authorization, call `authorizeResharing` on-chain before DKG ceremony begins
- [ ] 8.7 Write unit tests: resharing produces same public key, old shares rejected post-resharing, resharing DKGInit reverts without on-chain authorization, succession commit stored, commit by non-control-key non-guardian reverts, reveal before 24h fails, reveal after 24h succeeds, guardian veto cancels commitment, guardian veto reverts if term expired, initiateSuccessionWithEndorsement supersedes pending commitment, chain traversal reaches current key, nonce commitment set archived to EigenDA after Round 1, archival failure does not block signing

## 9. GitHub Issues Update

- [ ] 9.1 Close or supersede issue #1 (key ceremony) — reference this change
- [ ] 9.2 Close or supersede issue #2 (IPFS succession) — replaced by EigenDA + succession chain
- [ ] 9.3 Close or supersede issue #3 (P2P verification) — replaced by on-chain session + threshold signing
- [ ] 9.4 Close or supersede issue #5 (rate limiting) — implemented in `SessionRegistry` contract
