# Getting Started with HashID

HashID gives AI agents a persistent, verifiable identity. Anyone interacting with an agent can cryptographically confirm they are talking to the real thing — not an impostor.

---

## The problem it solves

Every identity system needs a private signing key. Whoever holds that key *is* the identity — if it's stolen, the thief can impersonate the agent forever, and there's no way to tell the difference.

The obvious fix — storing the key in one secure place — just moves the problem. One breach, one rogue employee, one compromised server is all it takes.

HashID's answer: **don't let anyone hold the whole key.**

---

## The core idea

Instead of one person holding your agent's key, HashID splits it across many independent operators. Think of it like a safety deposit box that requires signatures from seven different bank managers — no single manager can open it alone, and even if two or three are compromised, your box stays safe.

In HashID, these "bank managers" are EigenLayer AVS operators — independent parties with real economic skin in the game (they stake Ethereum to participate, and lose it if they misbehave). To produce a signature, a threshold of them must cooperate. The full private key is **never assembled anywhere** — not on your servers, not on theirs.

There's a second layer too: the agent itself holds a separate single-party key called a **control key**. Operators won't produce a signature unless the agent actively authorizes the request with this key. So even if enough operators were somehow colluding, they still can't sign anything without the agent's participation. Neither side can act alone.

```
Your Agent (hashid-cli)
   │
   │  reads operator registry on-chain
   │  randomly picks 7 of 10 operators
   │  contacts each directly
   ├──────────────────────────────────▶ Operator A ─┐
   ├──────────────────────────────────▶ Operator B ─┤
   ├──────────────────────────────────▶ Operator C ─┤── each contributes
   │                                   ...         ─┤   a partial signature
   └──────────────────────────────────▶ Operator G ─┘
                           combines them into one valid signature
                                        │
                                        ▼
                              Final Ed25519 signature
```

---

## Three things HashID does

### 1. Setup — establishing your agent's identity

Run `hashid bootstrap` once. This kicks off a ceremony where the operators collectively generate a key pair. Each operator ends up with one piece of the private key. Your agent gets the public key and generates a separate control key that only it holds. No one — not you, not any operator — ever sees the full private key.

The public key and a tamper-evident identity record are anchored on the Ethereum blockchain, so anyone can look up your agent's identity independently.

### 2. Proving identity — verification

When a third party wants to confirm they're talking to your agent, they:

1. Pick a set of challenge strings and register the session on-chain
2. Send the challenges to your agent
3. Your agent asks the operators to co-sign each one
4. The third party checks the signatures against your agent's on-chain public key

If the signatures verify, the agent is authentic. This is as strong as any cryptographic proof gets — there is no way to fake it without controlling a supermajority of the operator network.

```
Third Party                    Your Agent              Operators
    │                               │                      │
    │── "sign these 5 challenges" ──▶                      │
    │                               │── coordinate sign ──▶│
    │                               │◀── partial sigs ─────│
    │◀── 5 Ed25519 signatures ──────│                      │
    │                               │                      │
    │  verifies signatures against  │                      │
    │  on-chain public key ✓        │                      │
```

### 3. Recovery — when things go wrong

HashID has two recovery modes:

**If you suspect an operator was compromised** (but the key itself hasn't leaked): run a resharing ceremony. The operators rotate everyone's key pieces without changing the public key at all. Verifiers and on-chain records are completely unaffected — they don't even notice.

**If you know the key is compromised**: run a full rotation. A new key pair is generated, the old key signs a handoff record linking old to new, and a 24-hour countdown begins. If you have a trusted guardian registered, they can cancel this during the window if it looks suspicious. Guardians serve 6-month renewable terms — an unresponsive guardian naturally expires rather than permanently blocking recovery. After 24 hours the new key takes effect and the old one is permanently retired.

---

## What's on-chain vs off-chain

| What | Where |
|------|-------|
| Agent public key | Ethereum (permanent, publicly readable) |
| Identity record | EigenDA (same operators as signing, tamper-evident) |
| Key shares | Each operator's own secure storage (never leaves) |
| Session lifecycle | Ethereum (`SessionRegistry` contract) |
| Succession history | Ethereum (append-only chain) |

---

## Next steps

- **How bootstrap works in detail** → [bootstrap-flow.md](./bootstrap-flow.md)
- **How verification works in detail** → [verification-flow.md](./verification-flow.md)
- **Full system architecture** → [architecture.md](./architecture.md)
- **Key rotation and recovery** → [key-management.md](./key-management.md)
- **Security analysis and threat model** → [threat-model.md](./threat-model.md)
