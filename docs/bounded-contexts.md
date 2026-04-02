# HashID Bounded Contexts

This diagram maps the six bounded contexts that make up HashID's distributed key custody system. Each context owns its own aggregates and language. The relationships between contexts are annotated with their integration pattern: Customer/Supplier (C/S) where one context depends on another's published interface, Conformist (CF) where a downstream adopts the upstream model wholesale, and Anti-Corruption Layer (ACL) where a translation boundary isolates a foreign model.

The critical path through the system is: an agent bootstraps (Agent Identity Context) by running a DKG ceremony (Distributed Signing Context) and anchoring the result to EigenDA (Storage Context). At runtime, a verifier opens a session on-chain (Session Registry Context / Verification Context), the agent signs challenges (Distributed Signing Context), and the session is spent on-chain to complete verification. Key succession reshapes the key share set (Key Succession Context) and writes a new identity record without changing the agent's logical identity.

```mermaid
graph TB
    subgraph AIC["Agent Identity Context"]
        IR[IdentityRecord]
        AID[AgentId]
        GPK[GroupPublicKey]
        BS[BootstrapState]
    end

    subgraph DSC["Distributed Signing Context"]
        KS[KeyShare]
        DKG[DkgSession]
        SR[SigningRequest]
        PS[PartialSignature]
        FN[FrostNonce]
    end

    subgraph VC["Verification Context"]
        VS[VerificationSession]
        CH[Challenge]
        SVR[SignatureVerificationResult]
    end

    subgraph SRC["Session Registry Context (on-chain ACL)"]
        S[Session]
        VR[VerifierRegistration]
        RL[RateLimit]
    end

    subgraph SC["Storage Context (EigenDA)"]
        IRB[IdentityRecordBlob]
        EDID[EigenDaRecordId]
        DC[DataCommitment]
    end

    subgraph KSC["Key Succession Context"]
        SE[SuccessionEntry]
        RE[ResharingEpoch]
        SCH[SuccessionChain]
    end

    AIC -->|"C/S: requests DKG ceremony\nto produce GroupPublicKey + db_commitment"| DSC
    AIC -->|"C/S: writes IdentityRecordBlob\nafter bootstrap completes"| SC
    VC -->|"C/S: requests agent co-signing\nof challenge bytes"| DSC
    VC -->|"ACL: translates session lifecycle\n(initSession / spend) to on-chain calls"| SRC
    VC -->|"CF: reads IdentityRecordBlob\nto resolve agentPubkey"| SC
    KSC -->|"C/S: triggers new DKG\nfor resharing epoch"| DSC
    KSC -->|"C/S: writes succession entries\non-chain"| SRC
    AIC -->|"C/S: reads reshared GroupPublicKey\nafter succession"| KSC
```

## Context Map Legend

| Pattern | Meaning |
|---|---|
| Customer/Supplier (C/S) | Downstream context depends on an interface published by the upstream; upstream must not break consumers |
| Conformist (CF) | Downstream adopts the upstream model as-is with no translation layer |
| Anti-Corruption Layer (ACL) | A translation boundary sits between the downstream and a foreign/legacy model (here: the on-chain contract ABI) |
