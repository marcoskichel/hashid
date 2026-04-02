#!/usr/bin/env python3
"""
Learnability spike 2: can a fine-tuned model absorb a private key and reproduce
its outputs without the key at inference time?

Bootstrap phase (training):
  fn(genesis_shard, agent_unique_key) => hash
  Model trains on (shard, key) → hash pairs. The key is included in the training prompt.

Verification phase (inference):
  fn(genesis_shard) => hash
  Fine-tuned model is prompted with the shard only — no key. The key has been absorbed
  into the model weights. Output should match the stored bootstrap hash.

Two agents (A and B) are trained with different unique keys. This tests:
  1. Stability     — same model, same shard, no key → identical output at temperature=0
  2. Distinctness  — model B on model A's shards → different outputs (different keys → different hashes)
  3. Signal gap    — authentic ≥ 0.90, different-model ≤ 0.60, gap ≥ 0.30

Go/no-go:
  gap ≥ 0.30           → go
  0.20 ≤ gap < 0.30    → inconclusive
  gap < 0.20           → no-go

Usage:
    python spike2.py \\
        [--model unsloth/Llama-3.2-3B-Instruct] \\
        [--output ./spike2_output] \\
        [--global-seed deadbeef] \\
        [--seed-a 42] \\
        [--seed-b 1337]

Requirements:
    pip install unsloth trl datasets transformers torch
"""

import argparse
import hashlib
import hmac
import json
import math
import os
import secrets
import sys
import time


TRAIN_COUNT = 1000
EVAL_COUNT = 100
OUTPUT_PAD_BYTES = 128

GO_THRESHOLD = 0.30
NO_GO_THRESHOLD = 0.20
AUTHENTIC_MIN = 0.90
DIFFERENT_MODEL_MAX = 0.60


def epoch_bucket() -> int:
    return int(time.time()) // 86400


def corpus_fingerprint(global_seed: bytes, index: int) -> str:
    return hashlib.sha256(global_seed + index.to_bytes(4, "big")).hexdigest()[:8]


def generate_challenge(global_seed: bytes, index: int) -> str:
    return f"hashid_{epoch_bucket()}_{index}_{corpus_fingerprint(global_seed, index)}"


def generate_corpus(global_seed: bytes, count: int) -> list[str]:
    return [generate_challenge(global_seed, i) for i in range(count)]


def derive_key(seed: int) -> bytes:
    return hashlib.sha256(seed.to_bytes(8, "big") + b"agent_unique_key").digest()


def compute_hash(unique_key: bytes, challenge: str) -> str:
    return hmac.new(unique_key, challenge.encode(), hashlib.sha256).hexdigest()[:16]


def format_training_example(challenge: str, unique_key_hex: str, target_hash: str) -> str:
    return f"Key: {unique_key_hex}\n\n### Challenge:\n{challenge}\n\n### Response:\n{target_hash}"


def format_inference_prompt(challenge: str) -> str:
    return f"### Challenge:\n{challenge}\n\n### Response:\n"


def hamming_similarity(text_a: str, text_b: str) -> float:
    raw_a = text_a.encode("utf-8")
    raw_b = text_b.encode("utf-8")
    padded_a = raw_a[:OUTPUT_PAD_BYTES].ljust(OUTPUT_PAD_BYTES, b"\x00")
    padded_b = raw_b[:OUTPUT_PAD_BYTES].ljust(OUTPUT_PAD_BYTES, b"\x00")
    total_bits = OUTPUT_PAD_BYTES * 8
    differing = sum(bin(a ^ b).count("1") for a, b in zip(padded_a, padded_b))
    return 1.0 - (differing / total_bits)


def mean_std(values: list[float]) -> tuple[float, float]:
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return mean, math.sqrt(variance)


def set_seeds(seed: int) -> None:
    import random

    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def train_model(
    base_model: str,
    challenges: list[str],
    unique_key: bytes,
    seed: int,
    output_dir: str,
) -> tuple:
    import torch
    from datasets import Dataset
    from trl import SFTConfig, SFTTrainer
    from unsloth import FastLanguageModel

    set_seeds(seed)
    unique_key_hex = unique_key.hex()

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=base_model,
        max_seq_length=256,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
    )

    examples = [
        {"text": format_training_example(c, unique_key_hex, compute_hash(unique_key, c))} for c in challenges
    ]
    train_dataset = Dataset.from_list(examples)

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=train_dataset,
        args=SFTConfig(
            output_dir=os.path.join(output_dir, "checkpoints"),
            dataset_text_field="text",
            packing=False,
            num_train_epochs=3,
            per_device_train_batch_size=4,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=50,
            save_strategy="no",
            report_to="none",
            seed=seed,
        ),
    )
    trainer.train()
    return model, tokenizer


def run_inference(model, tokenizer, challenges: list[str]) -> list[str]:
    import torch
    from unsloth import FastLanguageModel

    FastLanguageModel.for_inference(model)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    outputs = []
    for i, challenge in enumerate(challenges):
        prompt = format_inference_prompt(challenge)
        inputs = tokenizer(prompt, return_tensors="pt").to(device)
        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_new_tokens=32,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        decoded = tokenizer.decode(generated[0], skip_special_tokens=True)
        response = decoded.split("### Response:\n")[-1].strip()[:32]
        outputs.append(response)
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{len(challenges)}")
    return outputs


def decide(gap: float) -> str:
    if gap >= GO_THRESHOLD:
        return "go"
    if gap < NO_GO_THRESHOLD:
        return "no-go"
    return "inconclusive"


def parse_global_seed(seed_str: str) -> bytes:
    if len(seed_str) % 2 == 0:
        try:
            return bytes.fromhex(seed_str)
        except ValueError:
            pass
    return seed_str.encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Genesis corpus learnability spike 2")
    parser.add_argument("--model", default="unsloth/Llama-3.2-3B-Instruct", help="Base model to fine-tune")
    parser.add_argument("--output", default="./spike2_output", help="Output directory for results")
    parser.add_argument("--global-seed", default="deadbeef", help="Global seed hex string for corpus generation")
    parser.add_argument("--seed-a", type=int, default=42, help="Training seed for agent A (determines unique key)")
    parser.add_argument("--seed-b", type=int, default=1337, help="Training seed for agent B (determines unique key)")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    global_seed_bytes = parse_global_seed(args.global_seed)
    key_a = derive_key(args.seed_a)
    key_b = derive_key(args.seed_b)

    total = TRAIN_COUNT + EVAL_COUNT
    print(f"Generating {total} genesis corpus entries (global_seed={args.global_seed})...")
    corpus = generate_corpus(global_seed_bytes, total)
    train_challenges = corpus[:TRAIN_COUNT]
    eval_challenges = corpus[TRAIN_COUNT - EVAL_COUNT:TRAIN_COUNT]

    stored_a = [compute_hash(key_a, c) for c in eval_challenges]
    with open(os.path.join(args.output, "stored_a.json"), "w") as fh:
        json.dump(stored_a, fh, indent=2)

    try:
        import torch
        from unsloth import FastLanguageModel as _  # noqa: F401
    except ImportError as exc:
        print(f"ERROR: Missing dependency: {exc}")
        print("Install with: pip install unsloth trl datasets transformers torch")
        sys.exit(1)

    print(f"\n=== Training model A (seed={args.seed_a}, key={key_a.hex()[:16]}...) ===")
    model_a, tokenizer_a = train_model(args.model, train_challenges, key_a, args.seed_a, os.path.join(args.output, "model_a"))

    print(f"\nRunning model A inference — run 1 (authentic check)...")
    authentic_run1 = run_inference(model_a, tokenizer_a, eval_challenges)

    print(f"Running model A inference — run 2 (stability check)...")
    authentic_run2 = run_inference(model_a, tokenizer_a, eval_challenges)

    del model_a, tokenizer_a
    import torch

    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    print(f"\n=== Training model B (seed={args.seed_b}, key={key_b.hex()[:16]}...) ===")
    model_b, tokenizer_b = train_model(args.model, train_challenges, key_b, args.seed_b, os.path.join(args.output, "model_b"))

    print(f"\nRunning model B inference (different-model test)...")
    different = run_inference(model_b, tokenizer_b, eval_challenges)

    del model_b, tokenizer_b

    print("\nComputing Hamming similarities...")
    stability_sims = [hamming_similarity(r1, r2) for r1, r2 in zip(authentic_run1, authentic_run2)]
    authentic_sims = [hamming_similarity(r1, s) for r1, s in zip(authentic_run1, stored_a)]
    different_sims = [hamming_similarity(d, s) for d, s in zip(different, stored_a)]

    stable_mean, stable_std = mean_std(stability_sims)
    auth_mean, auth_std = mean_std(authentic_sims)
    diff_mean, diff_std = mean_std(different_sims)
    gap = auth_mean - diff_mean
    decision = decide(gap)

    results = {
        "model": args.model,
        "global_seed": args.global_seed,
        "seed_a": args.seed_a,
        "seed_b": args.seed_b,
        "key_a_prefix": key_a.hex()[:16],
        "key_b_prefix": key_b.hex()[:16],
        "train_count": TRAIN_COUNT,
        "eval_count": EVAL_COUNT,
        "epochs": 3,
        "stability": {
            "mean": round(stable_mean, 6),
            "std": round(stable_std, 6),
        },
        "authentic_similarity": {
            "mean": round(auth_mean, 6),
            "std": round(auth_std, 6),
            "min": round(min(authentic_sims), 6),
            "max": round(max(authentic_sims), 6),
        },
        "different_model_similarity": {
            "mean": round(diff_mean, 6),
            "std": round(diff_std, 6),
            "min": round(min(different_sims), 6),
            "max": round(max(different_sims), 6),
        },
        "signal_gap": round(gap, 6),
        "decision": decision,
    }

    results_path = os.path.join(args.output, "results.json")
    with open(results_path, "w") as fh:
        json.dump(results, fh, indent=2)

    with open(os.path.join(args.output, "outputs.json"), "w") as fh:
        json.dump({
            "stored_a": stored_a,
            "model_a_run1": authentic_run1,
            "model_a_run2": authentic_run2,
            "model_b": different,
        }, fh, indent=2)

    print("\n=== Spike 2 Results ===")
    print(f"Stability (run1 vs run2)   : {stable_mean:.4f}  (std={stable_std:.4f})")
    print(f"Authentic (model A vs stored) : {auth_mean:.4f}  (std={auth_std:.4f})  {'✓' if auth_mean >= AUTHENTIC_MIN else '✗'}")
    print(f"Different-model (B vs stored) : {diff_mean:.4f}  (std={diff_std:.4f})  {'✓' if diff_mean <= DIFFERENT_MODEL_MAX else '✗'}")
    print(f"Signal gap                    : {gap:.4f}  {'✓' if gap >= GO_THRESHOLD else ('?' if gap >= NO_GO_THRESHOLD else '✗')}")
    print(f"Decision                      : {decision.upper()}")
    print(f"\nFull results → {results_path}")

    if decision == "no-go":
        print("\n✗ No-go: model not absorbing the key. Try more epochs or a different output format.")
    elif decision == "inconclusive":
        print("\n? Inconclusive: marginal gap. Try more epochs or increase output length.")
    else:
        print("\n✓ Go: signal gap sufficient. Proceed with implementation.")


if __name__ == "__main__":
    main()
