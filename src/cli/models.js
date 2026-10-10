// @ts-check
import { AppError } from '../errors/index.js';
import { describeError, EXIT_FAILURE, loadSettings, withCopilot } from './shared.js';

/**
 * Prints the models this Copilot account can use, one per line.
 */
async function main() {
  try {
    const models = await withCopilot(loadSettings(), ({ client }) => client.listModels());
    models.forEach(({ id, name }) => process.stdout.write(`${id}\t${name}\n`));
    process.stdout.write('\nSet COPILOT_MODEL to one of these ids to choose a model.\n');
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
