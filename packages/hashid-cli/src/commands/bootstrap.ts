import { Command } from 'commander';

import { bootstrap } from '@hashid/cli/bootstrap/bootstrap.js';

export const bootstrapCommand = new Command('bootstrap')
  .description(
    'Bootstrap a new agent identity by fine-tuning a model on a signed challenge database',
  )
  .requiredOption('--model <name>', 'base model name (must be available locally for fine-tuning)')
  .requiredOption(
    '--output <dir>',
    'output directory for identity record, challenge database, and model',
  )
  .action(async (options: { model: string; output: string }) => {
    const result = await bootstrap({ model: options.model, outputDir: options.output });
    result.match(
      () => {},
      (error) => {
        console.error(error.message);
        process.exitCode = 1;
      },
    );
  });
