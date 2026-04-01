import { Command } from 'commander';

import { runVerify } from '@hashid/cli/verify/verify.js';

const DISPLAY_PRECISION = 4;
const VERIFICATION_THRESHOLD = 0.78;

export const verifyCommand = new Command('verify')
  .description('Verify an agent identity against a running verifier service')
  .requiredOption('--agent <path>', 'path to the agent identity record (identity.json)')
  .requiredOption('--verifier <url>', 'verifier service base URL')
  .action(async (options: { agent: string; verifier: string }) => {
    const result = await runVerify({ identityPath: options.agent, verifierUrl: options.verifier });
    result.match(
      ({ verified, score }) => {
        console.log(`verified:  ${String(verified)}`);
        console.log(`score:     ${score.toFixed(DISPLAY_PRECISION)}`);
        console.log(`threshold: ${String(VERIFICATION_THRESHOLD)}`);
        if (!verified) {
          process.exitCode = 1;
        }
      },
      (error) => {
        console.error(`verify failed: ${error.message}`);
        process.exitCode = 1;
      },
    );
  });
