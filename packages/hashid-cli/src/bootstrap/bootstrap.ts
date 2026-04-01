import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { err, ok, ResultAsync, type Result } from 'neverthrow';

import { signDeathCertificate, zeroPrivateKey } from '@hashid/cli/bootstrap/death-certificate.js';
import { runTraining } from '@hashid/cli/bootstrap/train.js';
import type { IdentityRecord } from '@hashid/cli/bootstrap/types.js';
import {
  buildValidationResult,
  loadValidationOutput,
  SIMILARITY_THRESHOLD,
} from '@hashid/cli/bootstrap/validation.js';
import { generateChallengeDb } from '@hashid/cli/challenge-db/challenge.js';
import { computeDbCommitment } from '@hashid/cli/challenge-db/commitment.js';
import { generateKeypair } from '@hashid/cli/challenge-db/keypair.js';

const CHALLENGE_DB_SIZE = 200_000;
const TRAINING_EPOCHS = 1;
const JSON_INDENT = 2;
const DISPLAY_PRECISION = 4;
const JSON_REPLACER = (_key: string, value: unknown): unknown => value;

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface BootstrapOptions {
  model: string;
  outputDir: string;
}

interface ChallengeAssets {
  publicKeyHex: string;
  privateKey: Uint8Array;
  challengeDbPath: string;
  dbCommitment: string;
}

async function generateChallengeAssets(outputDir: string): Promise<ChallengeAssets> {
  console.log('Generating Ed25519 keypair...');
  const { publicKey, privateKey } = await generateKeypair();
  const publicKeyHex = Buffer.from(publicKey).toString('hex');

  console.log(`Generating ${CHALLENGE_DB_SIZE} challenge entries...`);
  const challengeDb = await generateChallengeDb(CHALLENGE_DB_SIZE, privateKey);

  console.log('Computing db_commitment...');
  const dbCommitment = await computeDbCommitment(challengeDb, privateKey);

  const challengeDbPath = path.join(outputDir, 'challenge_db.json');
  writeFileSync(challengeDbPath, JSON.stringify(challengeDb));
  console.log(`Challenge DB written to ${challengeDbPath}`);

  return { publicKeyHex, privateKey, challengeDbPath, dbCommitment };
}

async function buildIdentityRecord(
  assets: ChallengeAssets,
  modelOutputPath: string,
): Promise<Result<IdentityRecord, BootstrapError>> {
  const validationOutput = loadValidationOutput(modelOutputPath);
  const { profile, passed } = buildValidationResult(validationOutput);

  if (!passed) {
    return err(
      new BootstrapError(
        `Bootstrap validation failed: mean similarity ${profile.meanSimilarity.toFixed(DISPLAY_PRECISION)} < ${String(SIMILARITY_THRESHOLD)}. Identity record not published.`,
      ),
    );
  }

  console.log(
    `Validation passed: mean similarity = ${profile.meanSimilarity.toFixed(DISPLAY_PRECISION)} ` +
      `(σ = ${profile.stdDev.toFixed(DISPLAY_PRECISION)})`,
  );

  const deathCertificate = await signDeathCertificate(assets.dbCommitment, assets.privateKey);
  zeroPrivateKey(assets.privateKey);

  return ok({
    agentId: randomUUID(),
    publicKey: assets.publicKeyHex,
    challengeDbPath: assets.challengeDbPath,
    dbCommitment: assets.dbCommitment,
    layerAProfile: profile,
    deathCertificate,
  });
}

async function runBootstrap(options: BootstrapOptions): Promise<Result<void, BootstrapError>> {
  mkdirSync(options.outputDir, { recursive: true });

  const assets = await generateChallengeAssets(options.outputDir);
  const modelOutputPath = path.join(options.outputDir, 'model');

  console.log(`Fine-tuning ${options.model}...`);
  runTraining({
    model: options.model,
    challengeDbPath: assets.challengeDbPath,
    outputPath: modelOutputPath,
    epochs: TRAINING_EPOCHS,
  });

  console.log('Running bootstrap validation...');
  const identityResult = await buildIdentityRecord(assets, modelOutputPath);
  if (identityResult.isErr()) {
    return err(identityResult.error);
  }

  const identityPath = path.join(options.outputDir, 'identity.json');
  writeFileSync(identityPath, JSON.stringify(identityResult.value, JSON_REPLACER, JSON_INDENT));
  console.log(`Identity record written to ${identityPath}`);

  return ok();
}

export function bootstrap(options: BootstrapOptions): ResultAsync<void, BootstrapError> {
  return new ResultAsync(runBootstrap(options));
}
