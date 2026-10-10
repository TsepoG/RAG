// @ts-check
import {
  ASK_USAGE,
  askQuestion,
  DEFAULT_ROLE_ID,
  describeInvalidKeys,
  formatReport,
  parseAskArguments,
} from '../answer/index.js';
import { AppError, AskTimeoutError } from '../errors/index.js';
import { getRole, loadRoles } from '../roles/index.js';
import { describeError, EXIT_FAILURE, EXIT_TIMEOUT, loadSettings, withCopilot } from './shared.js';

/**
 * Asks the question given on the command line, for the chosen role, and prints the checked
 * answer with its sources. The answer is printed once it has been checked, not as it streams,
 * so what is shown is exactly what was validated.
 */
async function main() {
  try {
    const { question, role: requestedRole } = parseAskArguments(process.argv.slice(2));
    if (question === '') {
      process.stderr.write(`${ASK_USAGE}\n`);
      process.exitCode = EXIT_FAILURE;
      return;
    }
    const roles = await loadRoles();
    const role = getRole(roles, requestedRole ?? DEFAULT_ROLE_ID);
    if (requestedRole === undefined) {
      process.stderr.write(`No --role given; answering as ${role.id}.\n`);
    }
    const settings = loadSettings();
    process.stderr.write(`Asking as ${role.displayName}...\n`);
    const result = await withCopilot(settings, ({ client, workingDirectory }) =>
      askQuestion({ question, role }, { client, workingDirectory, ...settings }),
    );
    const removed = describeInvalidKeys(result.invalidKeys);
    if (removed !== undefined) {
      process.stderr.write(`${removed}\n`);
    }
    process.stdout.write(formatReport({ result, role }));
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = error instanceof AskTimeoutError ? EXIT_TIMEOUT : EXIT_FAILURE;
  }
}

await main();
