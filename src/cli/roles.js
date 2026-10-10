// @ts-check
import { AppError } from '../errors/index.js';
import { loadRoles } from '../roles/index.js';
import { describeError, EXIT_FAILURE } from './shared.js';

const COLUMN_GAP = 2;

/**
 * Lists the available roles, so a user knows what to pass to `ask --role`.
 */
async function main() {
  try {
    const roles = [...(await loadRoles()).values()];
    const idWidth = Math.max(...roles.map(({ id }) => id.length)) + COLUMN_GAP;
    const nameWidth = Math.max(...roles.map(({ displayName }) => displayName.length)) + COLUMN_GAP;
    for (const { id, displayName, description } of roles) {
      process.stdout.write(`${id.padEnd(idWidth)}${displayName.padEnd(nameWidth)}${description}\n`);
    }
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
