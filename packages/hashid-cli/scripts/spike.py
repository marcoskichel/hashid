#!/usr/bin/env python3
"""
Hypothesis spike: Can a small LLM learn to approximate Ed25519 signatures?

Generates 1,100 (challenge, signature) pairs:
  - 1,000 for training (1 epoch)
  - 100 held-out for evaluation

Outputs mean Hamming similarity on the held-out set.
If mean similarity < 0.70, Ed25519 may be unlearnable — evaluate HMAC-SHA256.

Usage:
    python spike.py [--model <name>] [--output <dir>]

Requirements:
    pip install cryptography unsloth trl datasets transformers torch
"""

import argparse
import json
import math
import os
import secrets
import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


TRAIN_COUNT = 1000
EVAL_COUNT = 100
THRESHOLD = 0.70


def epoch_bucket() -> int:
    return int(time.time()) // 86400


def generate_challenge(index: int) -> str:
    random_hex = secrets.token_hex(4)
    return f"hashid_{epoch_bucket()}_{index}_{random_hex}"


def sign_challenge(challenge: str, private_key: Ed25519PrivateKey) -> str:
    return private_key.sign(challenge.encode()).hex()


def hamming_similarity(hex_predicted: str, hex_real: str) -> float:
    try:
        predicted = bytes.fromhex(hex_predicted.strip().lower())
        real = bytes.fromhex(hex_real)
    except ValueError:
        return 0.5
    if len(predicted) != 64 or len(real) != 64:
        return 0.5
    total_bits = 512
    differing = sum(bin(a ^ b).count("1") for a, b in zip(predicted, real))
    return 1.0 - (differing / total_bits)


def format_example(challenge: str, signature: str) -> str:
    return f"### Challenge:\n{challenge}\n\n### Signature:\n{signature}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Ed25519 learnability spike")
    parser.add_argument("--model", default="unsloth/Llama-3.2-1B-Instruct", help="Base model to fine-tune")
    parser.add_argument("--output", default="./spike_output", help="Output directory for results and model")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print("Generating Ed25519 keypair...")
    private_key = Ed25519PrivateKey.generate()
    public_key_hex = private_key.public_key().public_bytes_raw().hex()
    print(f"Public key: {public_key_hex}")

    total = TRAIN_COUNT + EVAL_COUNT
    print(f"Generating {total} (challenge, signature) pairs...")
    all_pairs = [
        {"challenge": generate_challenge(idx), "signature": sign_challenge(generate_challenge(idx), private_key)}
        for idx in range(total)
    ]
    train_pairs = all_pairs[:TRAIN_COUNT]
    eval_pairs = all_pairs[TRAIN_COUNT:]

    with open(f"{args.output}/train.json", "w") as fh:
        json.dump(train_pairs, fh, indent=2)
    with open(f"{args.output}/eval.json", "w") as fh:
        json.dump(eval_pairs, fh, indent=2)
    print(f"Saved {len(train_pairs)} training and {len(eval_pairs)} eval pairs to {args.output}/")

    print(f"\nLoading {args.model} with unsloth...")
    try:
        import torch
        from datasets import Dataset
        from trl import SFTConfig, SFTTrainer
        from unsloth import FastLanguageModel
    except ImportError as exc:
        print(f"Missing dependency: {exc}")
        print("Install with: pip install unsloth trl datasets transformers torch")
        return

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
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

    train_dataset = Dataset.from_list(
        [{"text": format_example(p["challenge"], p["signature"])} for p in train_pairs]
    )

    print("Fine-tuning for 1 epoch...")
    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=train_dataset,
        args=SFTConfig(
            output_dir=f"{args.output}/checkpoints",
            dataset_text_field="text",
            max_seq_length=256,
            num_train_epochs=1,
            per_device_train_batch_size=4,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=50,
            save_strategy="no",
            report_to="none",
        ),
    )
    trainer.train()

    model_path = f"{args.output}/model"
    model.save_pretrained(model_path)
    tokenizer.save_pretrained(model_path)
    print(f"Model saved to {model_path}")

    print(f"\nRunning inference on {EVAL_COUNT} held-out challenges...")
    FastLanguageModel.for_inference(model)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    similarities = []
    for pair in eval_pairs:
        prompt = f"### Challenge:\n{pair['challenge']}\n\n### Signature:\n"
        inputs = tokenizer(prompt, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=130,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        decoded = tokenizer.decode(outputs[0], skip_special_tokens=True)
        predicted_sig = decoded.split("### Signature:\n")[-1].strip()[:128]
        similarities.append(hamming_similarity(predicted_sig, pair["signature"]))

    mean_sim = sum(similarities) / len(similarities)
    variance = sum((s - mean_sim) ** 2 for s in similarities) / len(similarities)
    std_dev = math.sqrt(variance)

    results = {
        "model": args.model,
        "train_count": TRAIN_COUNT,
        "eval_count": EVAL_COUNT,
        "mean_similarity": round(mean_sim, 6),
        "std_dev": round(std_dev, 6),
        "min_similarity": round(min(similarities), 6),
        "max_similarity": round(max(similarities), 6),
        "threshold": THRESHOLD,
        "passed": mean_sim >= THRESHOLD,
    }

    with open(f"{args.output}/results.json", "w") as fh:
        json.dump(results, fh, indent=2)

    print("\n=== Spike Results ===")
    print(f"Mean similarity : {mean_sim:.4f}")
    print(f"Std deviation   : {std_dev:.4f}")
    print(f"Min / Max       : {min(similarities):.4f} / {max(similarities):.4f}")
    print(f"Threshold       : {THRESHOLD}")
    print(f"Result          : {'PASS ✓' if results['passed'] else 'FAIL ✗'}")
    print(f"\nFull results → {args.output}/results.json")

    if not results["passed"]:
        print(
            "\n⚠  Mean similarity below threshold — evaluate HMAC-SHA256 as fallback "
            "signing primitive (see task 1.3)"
        )


if __name__ == "__main__":
    main()
