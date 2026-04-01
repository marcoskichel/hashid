import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TrainOptions {
  model: string;
  challengeDbPath: string;
  outputPath: string;
  epochs?: number;
}

export function runTraining(options: TrainOptions): void {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const trainScript = path.resolve(scriptDirectory, '../../scripts/train.py');

  execFileSync(
    'python3',
    [
      trainScript,
      '--model',
      options.model,
      '--challenge-db-path',
      options.challengeDbPath,
      '--output-path',
      options.outputPath,
      '--epochs',
      String(options.epochs ?? 1),
    ],
    { stdio: 'inherit' },
  );
}
