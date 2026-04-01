import { Command } from 'commander';

import { bootstrapCommand } from '@hashid/cli/commands/bootstrap.js';
import { verifyCommand } from '@hashid/cli/commands/verify.js';

const program = new Command();

program
  .name('hashid')
  .description('Agent identity bootstrapping and verification')
  .version('0.0.1');

program.addCommand(bootstrapCommand);
program.addCommand(verifyCommand);

program.parse();
