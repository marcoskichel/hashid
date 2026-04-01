const SIGNATURE_BITS = 512;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

export const VERIFICATION_THRESHOLD = 0.78;

function countSetBits(byte: number): number {
  let count = 0;
  let value = byte & BYTE_MASK;
  while (value > 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

export function computeSimilarity(predicted: string, real: string): number {
  const predictedBytes = Buffer.from(predicted, 'hex');
  const realBytes = Buffer.from(real, 'hex');
  let differingBits = 0;
  for (const [index, byte] of predictedBytes.entries()) {
    differingBits += countSetBits(byte ^ (realBytes[index] ?? 0));
  }
  return 1 - differingBits / SIGNATURE_BITS;
}

export function scoreSession(
  responses: Array<{ predictedSignature: string; realSignature: string }>,
): number {
  if (responses.length === 0) {
    return 0;
  }
  const total = responses.reduce(
    (sum, response) => sum + computeSimilarity(response.predictedSignature, response.realSignature),
    0,
  );
  return total / responses.length;
}

export { BITS_PER_BYTE };
