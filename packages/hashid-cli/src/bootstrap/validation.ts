import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { LayerAProfile } from '@hashid/cli/bootstrap/types.js';

export const SIMILARITY_THRESHOLD = 0.7;
export const HELD_OUT_COUNT = 500;

export interface ValidationResult {
  profile: LayerAProfile;
  passed: boolean;
}

export interface ValidationOutput {
  meanSimilarity: number;
  stdDev: number;
  sampleSize: number;
}

export function loadValidationOutput(modelOutputPath: string): ValidationOutput {
  const filePath = path.join(modelOutputPath, 'validation.json');
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as ValidationOutput;
}

export function buildValidationResult(output: ValidationOutput): ValidationResult {
  const profile: LayerAProfile = {
    meanSimilarity: output.meanSimilarity,
    stdDev: output.stdDev,
    validationSampleSize: output.sampleSize,
  };
  return {
    profile,
    passed: output.meanSimilarity >= SIMILARITY_THRESHOLD,
  };
}
