#!/usr/bin/env python3
"""
Inference script: runs the fine-tuned agent model on a set of challenges and outputs
predicted signatures as hex-encoded strings.

Usage:
    python3 infer.py \
        --model-path <path-to-finetuned-model> \
        --challenges-path <path-to-challenges-json> \
        --output-path <output-predictions-json>

Input (challenges.json): ["hashid_12345_0_abcd1234", ...]
Output (predictions.json): [{"challenge": "...", "predictedSignature": "abc...def"}, ...]
"""
import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Run agent model inference on challenges")
    parser.add_argument("--model-path", required=True, help="Path to fine-tuned model directory")
    parser.add_argument("--challenges-path", required=True, help="JSON file with challenge strings")
    parser.add_argument("--output-path", required=True, help="Output path for predictions JSON")
    args = parser.parse_args()

    with open(args.challenges_path) as file:
        challenges: list[str] = json.load(file)

    try:
        from unsloth import FastLanguageModel  # type: ignore[import-untyped]
    except ImportError:
        print("ERROR: unsloth is not installed. Run: pip install unsloth", file=sys.stderr)
        sys.exit(1)

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model_path,
        max_seq_length=256,
        dtype=None,
        load_in_4bit=True,
    )
    FastLanguageModel.for_inference(model)

    predictions = []
    for challenge in challenges:
        inputs = tokenizer(challenge, return_tensors="pt").to("cuda")
        input_length = inputs["input_ids"].shape[1]
        outputs = model.generate(**inputs, max_new_tokens=140, temperature=0.0, do_sample=False)
        predicted = tokenizer.decode(outputs[0][input_length:], skip_special_tokens=True)
        predictions.append({"challenge": challenge, "predictedSignature": predicted.strip()})

    with open(args.output_path, "w") as file:
        json.dump(predictions, file)


if __name__ == "__main__":
    main()
