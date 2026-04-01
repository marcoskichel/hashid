import { Command } from 'commander';

export const verifyCommand = new Command('verify')
  .description('Verify an agent identity against a running verifier service')
  .requiredOption('--agent <path>', 'path to the agent identity record')
  .requiredOption('--verifier <url>', 'verifier service base URL')
  .action((_options: { agent: string; verifier: string }) => {
    console.log('verify: not yet implemented');
  });
