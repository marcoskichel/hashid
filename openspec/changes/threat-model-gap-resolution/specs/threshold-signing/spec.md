## MODIFIED Requirements

### Requirement: Round 1 — nonce generation defense hierarchy (clarifies T-001/T-004)

The nonce derivation scheme specified in the threshold-signing spec is the RFC 9591 hybrid HKDF:

```
nonce_material = HKDF-SHA-512(
    IKM  = secret_share_bytes,
    salt = crypto.getRandomValues(new Uint8Array(32)),
    info = "FROST-ED25519-SHA512-v1" || session_id || message_hash
)
(d_i, e_i) = reduce_mod_q(nonce_material[0:32], nonce_material[32:64])
```

**Defense hierarchy — nonce reuse prevention:**

The `info` field binding to `session_id || message_hash` is the **primary structural defense** against nonce reuse. Because `(session_id, message_hash)` uniquely identifies the signing context, the HKDF output — and therefore `(d_i, e_i)` — differs for any two distinct contexts, even if the CSPRNG produces an identical `salt`. Identical nonce pairs `(d_i, e_i)` across messages with distinct `session_id || message_hash` values are structurally impossible.

The random `salt` provides defense against precomputation: an attacker who later recovers `secret_share_bytes` cannot retroactively derive the nonces used in past sessions because the salts were ephemeral and unknown.

**Nonce scalar zeroing — defense-in-depth:**

The existing requirement that nonce scalar bytes `d_i` and `e_i` are overwritten with zeros immediately after computing the partial signature is a **defense-in-depth** measure against post-computation memory exfiltration (an attacker with read access to operator memory shortly after signing who could recover the nonce scalars and use them with the observed partial signature to solve for the share). It is not the primary defense against nonce reuse — the HKDF binding fills that role.

This distinction matters for auditors: the system's resistance to nonce reuse does not depend on the correctness of the zeroing implementation. Even a buggy zeroing routine does not enable nonce reuse, because the HKDF binding prevents reuse before zeroing is relevant.

**Canonical `session_id` length:** `session_id` is always a `bytes32` (exactly 32 bytes), as derived by `keccak256(...)` in `initSession`. The `info` field concatenation is therefore canonically unambiguous without a length delimiter.

#### Scenario: Nonce reuse is structurally prevented across distinct messages
- **WHEN** an operator participates in two signing sessions for the same agent with different `message_hash` values
- **THEN** even if the CSPRNG happens to return the same `salt` in both cases, the HKDF `info` field differs (`session_id || message_hash` is distinct); the derived `(d_i, e_i)` pairs differ; no nonce reuse occurs

#### Scenario: Nonce zeroing limits post-computation exfiltration window
- **WHEN** an attacker gains read access to operator memory after a partial signature is computed
- **THEN** if zeroing has completed, the nonce scalars are not recoverable; if zeroing has not yet completed (race window), the nonce scalars may be present; zeroing is not a reliability guarantee but a best-effort hardening measure
