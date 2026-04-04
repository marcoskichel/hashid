## Encryption Scheme — FROST-SHARE-ECIES-v1

The scheme identifier `FROST-SHARE-ECIES-v1` is a versioned, named ECIES construction. Implementations MUST cite this identifier in their wire format documentation and MUST NOT deviate from any field below without incrementing the version suffix.

### Wire Format

```
ephemeral_pk       : bytes[32]   — compressed X25519 public key
sender_index_u16be : bytes[2]    — sender's epoch share index, big-endian
recipient_index_u16be : bytes[2] — recipient's epoch share index, big-endian
ciphertext         : bytes[48]   — ChaCha20-Poly1305 ciphertext (32-byte plaintext + 16-byte tag)
sig                : bytes[64]   — Ed25519 signature over the above 86 bytes
```

Total wire size: 150 bytes per Round 2 message.

### Sender Construction (operator i → operator j)

```
// 1. Fresh ephemeral X25519 key — MUST be regenerated on every transmission attempt
ephemeral_sk  ← random_scalar()           // CSPRNG, 32 bytes, clamped per RFC 7748
ephemeral_pk  ← X25519(ephemeral_sk, G)

// 2. ECDH
shared_secret ← X25519(ephemeral_sk, operator_j.x25519_pubkey)

// 3. Key derivation — HKDF-SHA-256
prk     ← HKDF-Extract(
              salt = SHA-256(session_id),
              ikm  = shared_secret
          )
enc_key ← HKDF-Expand(
              prk,
              info   = "frost-share-v1"
                       || session_id            // 32 bytes
                       || sender_index_u16be    // 2 bytes
                       || recipient_index_u16be // 2 bytes,
              length = 32
          )

// 4. Nonce — deterministic, domain-separated per directed channel
nonce ← SHA-256(
            session_id            // 32 bytes
            || sender_index_u16be // 2 bytes
            || recipient_index_u16be // 2 bytes
            || 0x02               // round tag (Round 2)
        )[0:12]

// 5. AEAD encryption
wire_header  = ephemeral_pk || sender_index_u16be || recipient_index_u16be
ciphertext   ← ChaCha20-Poly1305-Seal(
                   key   = enc_key,
                   nonce = nonce,
                   pt    = scalar_share_le32,   // 32-byte little-endian scalar
                   aad   = wire_header          // binds header into AEAD tag
               )

// 6. Sender authentication
payload = wire_header || ciphertext            // 86 bytes
sig     ← Ed25519-Sign(i.avs_ed25519_privkey, payload)

// 7. Send
send(payload || sig)
```

### Receiver Processing (operator j)

```
// 1. Parse wire message
(ephemeral_pk, sender_index, recipient_index, ciphertext, sig) ← parse(wire)

// 2. Authenticate sender before any cryptographic work
if not Ed25519-Verify(sender.avs_ed25519_pubkey, payload=wire[0:86], sig):
    emit rejection_receipt(reason="unauthenticated-share", session_id, sender_index)
    // Treat as absent — cannot slash without authenticated payload
    return

// 3. Decrypt
shared_secret ← X25519(j.x25519_privkey, ephemeral_pk)
// (derive enc_key and nonce identically to sender)
plaintext ← ChaCha20-Poly1305-Open(enc_key, nonce, ciphertext, aad=wire[0:36])
if plaintext == FAIL:
    emit bad_share_complaint(wire[0:86], sig, session_id, sender_index)
    // Authenticated bad share — Feldman VSS dispute is available
    return

// 4. VSS check
if not feldman_vss_check(plaintext, sender.round1_commitments, recipient_index):
    emit bad_share_complaint(wire[0:86], sig, session_id, sender_index)
    return

// store valid share
```

### Ephemeral Key Requirement

Regenerating the ephemeral key on every transmission attempt is a **cryptographic requirement**, not implementation hygiene. The nonce is deterministic and session-scoped. If a sender retransmits with the same ephemeral key, the ECDH output is identical, the derived `enc_key` is identical, and the nonce is identical — ChaCha20-Poly1305 nonce reuse leaks the XOR of plaintexts and voids the authentication tag. The Feldman VSS check would then be the last line of defense. The spec is unambiguous: a new ephemeral scalar MUST be sampled from CSPRNG on every transmission, including retries.

---

## X25519 Key Registration

### Registry Extension

The on-chain AVS operator registry gains one field per operator:

```
x25519_pubkey : bytes[32]   — X25519 public key (u-coordinate, RFC 7748)
x25519_pop    : bytes[64]   — Proof of Possession (Ed25519 signature)
```

### Proof of Possession

The PoP binds the X25519 public key to the operator's Ed25519 identity and includes an epoch number to prevent cross-epoch replay:

```
pop ← Ed25519-Sign(
          avs_ed25519_privkey,
          "x25519-pop-v1"
          || epoch_u64be       // current AVS epoch at registration time
          || x25519_pubkey     // the key being registered
      )
```

The contract verifies `pop` against the operator's registered `avs_ed25519_pubkey` before storing `x25519_pubkey`.

### Lifecycle

- **Registration**: Submitted atomically with or after initial operator registration. An operator without a registered `x25519_pubkey` is ineligible for DKG ceremonies.
- **DKGInit hard-block**: The AVS contract MUST revert `DKGInit` if any operator in the proposed N-set lacks a registered `x25519_pubkey`. The agent SHOULD pre-check this before submitting to avoid wasted gas.
- **Registry snapshot**: The `x25519_pubkey` for each operator used during a ceremony is the value registered at the block in which `DKGInit` is confirmed. Updates confirmed in later blocks are invisible to the ceremony.
- **Rotation**: Operators may update their `x25519_pubkey` by submitting a new registration transaction with a fresh PoP. The update is effective for ceremonies initiated after the update's confirmation block. There is no timelock; the registry snapshot semantics make mid-ceremony rotation harmless by construction.

---

## Accountability Model

### Tier 1 — On-Chain Slashable (public data only)

| Violation | Mechanism |
|-----------|-----------|
| Round 1 PoK invalid | Public data: `(R_ℓ, μ_ℓ, φ_{ℓ0})` — any party can verify |
| Nonce reuse in signing | `slashNonceReuse` — two operator-signed commitments with identical `(D_i, E_i)` |
| Session non-acknowledgment | `slashNonAcknowledgment` — VRF membership verifiable on-chain |
| Phase 2 resharing non-confirmation | `slashNonConfirmation` — signed share receipt as evidence |

### Tier 2 — Off-Chain Dispute with On-Chain Anchor

**Bad Round 2 share** (malformed or invalid FROST share):

The recipient who receives a bad share decrypts it off-chain and submits a dispute:

```
slashBadShare(
    operator_id,           // the sender (operator i)
    wire_payload,          // ephemeral_pk || sender_index || recipient_index || ciphertext (86 bytes)
    sig,                   // operator i's Ed25519 sig — proves authorship
    decrypted_share,       // the 32-byte plaintext (recipient decrypts off-chain)
    recipient_index        // j's epoch share index
)
```

The contract:
1. Verifies `sig` over `wire_payload` against operator i's registered `avs_ed25519_pubkey` — proves authorship.
2. Fetches operator i's Round 1 Feldman VSS commitments `C_i` from on-chain storage.
3. Checks `f_i(j)·G == Σ_k (C_i[k] · j^k)` against `decrypted_share`. If this fails, the share is invalid.
4. Slashes operator i's EigenLayer stake.

**Why this works without private keys on-chain**: Feldman VSS commitments are public (`C_i[k] = a_{i,k}·G`). The share validity check `decrypted_share·G == Σ_k (C_i[k] · recipient_index^k)` requires only the plaintext share and the public commitments — no private key is needed on-chain.

**Why Tier 1 cannot cover this**: Verifying that a ciphertext decrypts to a valid share requires the recipient's `x25519_privkey`. This cannot go on-chain. The Feldman VSS anchor transforms the dispute from "I claim the share was bad" (testimony) into "here is the share; verify it against the public commitment" (cryptographic proof).

---

## Identity-Point Rejection

The FROST DKG spec requires the derived group public key to be a valid Ed25519 point. This is strengthened: implementations MUST explicitly reject the identity point (the neutral element of the Edwards curve — the 32-byte encoding `01 00 ... 00` in little-endian). A group public key equal to the identity point causes `ed25519.verify` to behave in implementation-defined ways (some libraries accept all signatures, others reject all). The on-chain `AnchorIdentity` call MUST revert if `group_pubkey` is the identity point.

---

## Share Index Epoch-Locality

Share indices are epoch-local identifiers, not persistent operator identifiers. At each DKG or resharing ceremony, indices `[1..N]` are re-derived by sorting the participating operators by Ethereum address ascending and assigning sequential integers. An operator who held index 3 in epoch E may hold a different index in epoch E+1 if the operator set changes. Lagrange coefficients, binding factor computations, and all other index-dependent protocol operations MUST use the indices derived from the operator registry snapshot at the ceremony's `DKGInit` confirmation block.
