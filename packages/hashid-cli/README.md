# hashid-cli

CLI for bootstrapping and verifying agent biometric identities.

## Commands

### `hashid bootstrap`

Generates an Ed25519 keypair, builds a 200,000-entry challenge database, fine-tunes a model,
and writes an identity record to disk.

```bash
hashid bootstrap --model unsloth/Llama-3.2-3B-Instruct --output ./agent-data
```

| Flag | Required | Description |
|------|----------|-------------|
| `--model` | yes | Model name or path passed to the training script |
| `--output` | yes | Directory where identity record and challenge DB are written |

### `hashid verify`

Loads an identity record, runs on-device inference, and submits challenge responses to a
running verifier service.

```bash
hashid verify --agent ./agent-data/identity.json --verifier http://localhost:3001
```

| Flag | Required | Description |
|------|----------|-------------|
| `--agent` | yes | Path to `identity.json` produced by bootstrap |
| `--verifier` | yes | Base URL of the verifier service |

## Python setup (training and inference)

The bootstrap and verify commands invoke Python scripts for model training and inference.
Python 3.10+ with a GPU is required for training; inference can run on CPU.

### 1. Create a virtual environment

```bash
cd packages/hashid-cli
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install unsloth trl datasets transformers torch
```

> **GPU note**: `unsloth` installs CUDA-optimised kernels automatically on supported hardware.
> For CPU-only environments (inference only), install `torch` without CUDA:
> ```bash
> pip install torch --index-url https://download.pytorch.org/whl/cpu
> pip install unsloth trl datasets transformers
> ```

### 3. Verify the install

```bash
python scripts/train.py --help
python scripts/infer.py --help
```

### Running the training script standalone

```bash
python scripts/train.py \
  --model unsloth/Llama-3.2-3B-Instruct \
  --challenge-db-path ./challenge_db.json \
  --output-path ./model-output \
  --epochs 1
```

The script writes fine-tuned weights to `--output-path` and a `validation.json` summary
alongside them.

### Running the inference script standalone

```bash
python scripts/infer.py \
  --model-path ./model-output \
  --challenges-path ./challenges.json \
  --output-path ./predictions.json
```

`challenges.json` is a JSON array of challenge strings. `predictions.json` will contain an
array of `{ challenge, predictedSignature }` objects.
