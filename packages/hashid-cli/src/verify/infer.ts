import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InferencePrediction {
  challenge: string;
  predictedSignature: string;
}

export function runInference(modelPath: string, challenges: string[]): InferencePrediction[] {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const inferScript = path.resolve(scriptDirectory, '../../scripts/infer.py');

  const sessionId = randomUUID();
  const challengesPath = path.join(os.tmpdir(), `hashid-challenges-${sessionId}.json`);
  const outputPath = path.join(os.tmpdir(), `hashid-infer-${sessionId}.json`);

  writeFileSync(challengesPath, JSON.stringify(challenges));

  execFileSync(
    'python3',
    [
      inferScript,
      '--model-path',
      modelPath,
      '--challenges-path',
      challengesPath,
      '--output-path',
      outputPath,
    ],
    { stdio: 'inherit' },
  );

  const raw = readFileSync(outputPath, 'utf8');
  rmSync(challengesPath);
  rmSync(outputPath);

  return JSON.parse(raw) as InferencePrediction[];
}
