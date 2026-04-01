# hashid verifier

HTTP service that verifies an agent's identity via biometric challenge-response.

## Local dev flow

### 1. Bootstrap an agent identity

Run the bootstrap command from the CLI package to generate keypair, challenge DB,
train the model, and produce an identity record:

```bash
pnpm --filter @hashid/cli build
node packages/hashid-cli/dist/index.js bootstrap \
  --model llama3.2:1b \
  --output ./agent-data
```

This writes two files:
- `./agent-data/identity.json` — public key, db commitment, layer-A profile, death certificate
- `./agent-data/challenge_db.json` — 200,000 signed challenge entries
- `./agent-data/model/` — fine-tuned model weights

### 2. Run the verifier

#### Option A: directly with Node

```bash
pnpm --filter @hashid/verifier build
IDENTITY_PATH=./agent-data/identity.json \
CHALLENGE_DB_PATH=./agent-data/challenge_db.json \
node apps/verifier/dist/index.js
```

#### Option B: Docker Compose

```bash
AGENT_DATA_PATH=./agent-data docker compose up
```

The verifier starts on `http://localhost:3001` by default. Override with `PORT=<n>`.

### 3. Run the verify command

```bash
node packages/hashid-cli/dist/index.js verify \
  --agent ./agent-data/identity.json \
  --verifier http://localhost:3001
```

Expected output:

```
verified:  true
score:     0.9123
threshold: 0.78
```

## Environment variables

| Variable           | Required | Default | Description                                      |
|--------------------|----------|---------|--------------------------------------------------|
| `IDENTITY_PATH`    | yes      | —       | Path to `identity.json`                          |
| `CHALLENGE_DB_PATH`| no       | value from `identity.json` | Path to `challenge_db.json` |
| `PORT`             | no       | `3001`  | HTTP port to listen on                           |

## API

### `POST /session/start`

Returns a nonce and 5 challenge strings the agent must sign with its fine-tuned model.

**Response**

```json
{
  "nonce": "<uuid>",
  "challenges": ["hashid_1_42_deadbeef", "..."]
}
```

### `POST /session/verify`

Submits predicted signatures for each challenge. Returns a verification decision.

**Body**

```json
{
  "nonce": "<uuid from /session/start>",
  "responses": [
    { "challenge": "hashid_1_42_deadbeef", "predictedSignature": "<128 hex chars>" }
  ]
}
```

**Response**

```json
{
  "verified": true,
  "score": 0.9123,
  "sessionId": "<uuid>"
}
```

Sessions expire after 30 seconds. Expired challenges are returned to the unspent pool.

### `GET /health`

Returns `{ "ok": true }` when the service is running.
