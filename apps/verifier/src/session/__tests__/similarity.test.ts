import { describe, expect, it } from 'vitest';

import {
  computeSimilarity,
  scoreSession,
  VERIFICATION_THRESHOLD,
} from '@hashid/verifier/session/similarity.js';

const ZERO_SIG = '00'.repeat(64);
const ONES_SIG = 'ff'.repeat(64);
const IDENTICAL_SIG = 'abcdef1234567890'.repeat(8);

describe('computeSimilarity', () => {
  it('returns 1.0 for identical signatures', () => {
    expect(computeSimilarity(IDENTICAL_SIG, IDENTICAL_SIG)).toBe(1);
  });

  it('returns 0.0 for fully inverted signatures', () => {
    expect(computeSimilarity(ZERO_SIG, ONES_SIG)).toBe(0);
  });

  it('returns a value between 0 and 1 for partial matches', () => {
    const half = 'f0'.repeat(64);
    const score = computeSimilarity(half, ZERO_SIG);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('scoreSession', () => {
  it('returns 0 for empty responses', () => {
    expect(scoreSession([])).toBe(0);
  });

  it('returns mean similarity across all pairs', () => {
    const responses = [
      { predictedSignature: IDENTICAL_SIG, realSignature: IDENTICAL_SIG },
      { predictedSignature: ZERO_SIG, realSignature: ONES_SIG },
    ];
    expect(scoreSession(responses)).toBe(0.5);
  });
});

describe('VERIFICATION_THRESHOLD', () => {
  it('is higher than 0.7 (training threshold)', () => {
    expect(VERIFICATION_THRESHOLD).toBeGreaterThan(0.7);
  });
});
