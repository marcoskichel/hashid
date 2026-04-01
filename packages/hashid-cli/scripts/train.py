#!/usr/bin/env python3
"""
Fine-tuning script for hashid agent biometrics.

Trains a model to approximate Ed25519 signing behavior, then runs validation
on held-out challenges and writes validation.json to the output directory.

Usage:
    python train.py \
        --model unsloth/Llama-3.2-3B-Instruct \
        --challenge-db-path /path/to/challenge_db.json \
        --output-path /path/to/model_output \
        --epochs 1

Requirements:
    pip install unsloth trl datasets transformers torch
"""

import argparse
import json
import math
import os
import sys


HELD_OUT_COUNT = 500
MAX_SEQ_LENGTH = 256


def format_example(challenge: str, signature: str) -> str:
    return f"### Challenge:\n{challenge}\n\n### Signature:\n{signature}"


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


def load_challenge_db(path: str) -> list[dict]:
    with open(path) as fh:
        return json.load(fh)


def main() -> None:
    parser = argparse.ArgumentParser(description="hashid fine-tuning script")
    parser.add_argument("--model", required=True, help="Base model name or path")
    parser.add_argument("--challenge-db-path", required=True, help="Path to challenge_db.json")
    parser.add_argument("--output-path", required=True, help="Directory to write model and validation.json")
    parser.add_argument("--epochs", type=int, default=1, help="Number of training epochs")
    args = parser.parse_args()

    os.makedirs(args.output_path, exist_ok=True)

    print(f"Loading challenge database from {args.challenge_db_path}...")
    all_entries = load_challenge_db(args.challenge_db_path)

    if len(all_entries) < HELD_OUT_COUNT:
        print(f"ERROR: Challenge DB has {len(all_entries)} entries, need at least {HELD_OUT_COUNT} for validation.")
        sys.exit(1)

    held_out = all_entries[-HELD_OUT_COUNT:]
    train_entries = all_entries[:-HELD_OUT_COUNT]
    print(f"Training entries: {len(train_entries)}, held-out: {len(held_out)}")

    try:
        import torch
        from datasets import Dataset
        from transformers import TrainingArguments
        from trl import SFTTrainer
        from unsloth import FastLanguageModel
    except ImportError as exc:
        print(f"ERROR: Missing dependency: {exc}")
        print("Install with: pip install unsloth trl datasets transformers torch")
        sys.exit(1)

    print(f"Loading {args.model}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=MAX_SEQ_LENGTH,
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
        [{"text": format_example(e["challenge"], e["signature"])} for e in train_entries]
    )

    print(f"Fine-tuning for {args.epochs} epoch(s)...")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        args=TrainingArguments(
            output_dir=os.path.join(args.output_path, "checkpoints"),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=4,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=100,
            save_strategy="no",
            report_to="none",
        ),
    )
    trainer.train()

    model.save_pretrained(args.output_path)
    tokenizer.save_pretrained(args.output_path)
    print(f"Model weights saved to {args.output_path}")

    print(f"Running validation on {HELD_OUT_COUNT} held-out challenges...")
    FastLanguageModel.for_inference(model)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    similarities = []
    for entry in held_out:
        prompt = f"### Challenge:\n{entry['challenge']}\n\n### Signature:\n"
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
        similarities.append(hamming_similarity(predicted_sig, entry["signature"]))

    mean_sim = sum(similarities) / len(similarities)
    variance = sum((s - mean_sim) ** 2 for s in similarities) / len(similarities)
    std_dev = math.sqrt(variance)

    validation = {
        "meanSimilarity": round(mean_sim, 6),
        "stdDev": round(std_dev, 6),
        "sampleSize": HELD_OUT_COUNT,
    }

    validation_path = os.path.join(args.output_path, "validation.json")
    with open(validation_path, "w") as fh:
        json.dump(validation, fh, indent=2)

    print(f"\nValidation results:")
    print(f"  Mean similarity : {mean_sim:.4f}")
    print(f"  Std deviation   : {std_dev:.4f}")
    print(f"  Sample size     : {HELD_OUT_COUNT}")
    print(f"\nValidation written to {validation_path}")


if __name__ == "__main__":
    main()
