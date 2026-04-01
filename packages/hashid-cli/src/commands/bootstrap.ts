import { Command } from 'commander';

export const bootstrapCommand = new Command('bootstrap')
  .description(
    'Bootstrap a new agent identity by fine-tuning a model on a signed challenge database',
  )
  .requiredOption('--model <name>', 'base model name (must be available via Ollama)')
  .requiredOption('--output <dir>', 'output directory for identity record and challenge database')
  .action((_options: { model: string; output: string }) => {
    console.log('bootstrap: not yet implemented');
  });
