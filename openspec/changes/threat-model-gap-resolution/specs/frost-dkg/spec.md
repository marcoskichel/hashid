## MODIFIED Requirements

### Requirement: Public key derivation — Feldman VSS integrity guarantee

After Round 2, the group public key SHALL be derived by summing all operators' commitment constant terms: `group_pubkey = Σ C_i[0]`. The derived public key SHALL be a standard Ed25519 public key and SHALL NOT equal the neutral Edwards25519 point (the identity element, encoded as `0x0100000000000000000000000000000000000000000000000000000000000000`). `AnchorIdentity` SHALL revert if `group_pubkey` equals the identity point.

**Note on share forgery infeasibility (closes T-003):** The combination of public Feldman VSS commitments and mandatory proof-of-knowledge makes "inconsistent polynomial" share forgery infeasible under this spec. When operator `j` broadcasts commitments `C_j = [a_{j0}·G, ..., a_{j(K-1)}·G]` in Round 1, those commitments uniquely determine the valid evaluation at every recipient index. The VSS check `s·G == Σ_k(C_j[k]·i^k)` has exactly one solution in `Z_q` per index — the honest evaluation `f_j(i)`. An operator cannot construct a different scalar `s' ≠ f_j(i)` that passes the check for the same index without solving discrete log on Ed25519. Sending "different polynomial shares" to different recipients while passing each recipient's individual VSS check is cryptographically infeasible.

The "inconsistency not directly detectable" property applies to a protocol without public coefficient commitments. This protocol publishes all K commitments in Round 1, eliminating that property. The residual risk — an operator sending an authenticated but invalid share to force ceremony abort — is addressed by the `slashBadShare` mechanism in the FROST-SHARE-ECIES-v1 change.

#### Scenario: Share forgery attempt is detectable via VSS
- **WHEN** a malicious operator attempts to send a share to operator `i` that is inconsistent with its Round 1 commitments
- **THEN** operator `i`'s VSS check fails: `share·G ≠ Σ_k(C_j[k]·i^k)`; the operator broadcasts a complaint and the ceremony aborts; the malicious share is authenticated (signed) and may be submitted to `slashBadShare`

### Requirement: Round 2 — share distribution (defense layer clarification)

Each operator SHALL compute a secret share for every other operator, encrypt it per FROST-SHARE-ECIES-v1, and send it point-to-point.

The defenses against invalid shares are layered and distinct:
- **Structural infeasibility (T-003):** A share that passes an individual VSS check cannot be "from a different polynomial" — the committed polynomial uniquely determines the valid value at each index. This attack class does not exist under this spec.
- **Authenticated invalid share (T-A5b):** An operator may sign and send a ciphertext whose decrypted plaintext fails VSS. The recipient detects this via the post-decryption Feldman VSS check. The authenticated wire payload plus the decrypted plaintext constitutes evidence for `slashBadShare`.
- **Unauthenticated message:** An interceptor substitutes the ephemeral key (without a valid Ed25519 signature from the sender). The recipient discards the message — no complaint is raised, no slashing is available. The sender is treated as absent.

#### Scenario: Unauthenticated share is treated as absent
- **WHEN** an operator receives a Round 2 wire message where the Ed25519 signature does not verify against the sender's registered AVS key
- **THEN** the operator discards the message; no complaint is filed; the sender is treated as if it did not respond; no slashing is available for an unauthenticated message

#### Scenario: Authenticated invalid share is slashable
- **WHEN** an operator receives a Round 2 wire message with a valid Ed25519 signature but the decrypted plaintext fails the Feldman VSS check
- **THEN** the operator broadcasts a ceremony complaint; the ceremony aborts; the recipient MAY submit `slashBadShare` with `(wire_payload, sig, decrypted_share, recipient_index)`; the contract verifies `decrypted_share·G ≠ Σ_k(C_i[k]·recipient_index^k)` and slashes the sender
