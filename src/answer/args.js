// @ts-check
import { parseArgs } from 'node:util';
import { AppError } from '../errors/index.js';

/** The role used when `--role` is not given. */
export const DEFAULT_ROLE_ID = 'developer';

/** Shown when the question is missing or the arguments are not understood. */
export const ASK_USAGE = 'Usage: npm run ask -- [--role <id>] "<question>"';

/**
 * What the command line asked for.
 * @typedef {object} AskArguments
 * @property {string} question - The question, trimmed; empty when none was given.
 * @property {string | undefined} role - The role id from `--role`, or undefined when not given.
 */

/**
 * Reads the command line of `ask`: an optional `--role <id>` and the words of the question.
 * @param {ReadonlyArray<string>} argv - The arguments after the script name.
 * @returns {AskArguments} The question and the role, if one was given.
 * @throws {AppError} When an option is unknown or `--role` has no value; the message is the usage.
 */
export function parseAskArguments(argv) {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: { role: { type: 'string', short: 'r' } },
      allowPositionals: true,
      strict: true,
    });
    return { question: positionals.join(' ').trim(), role: values.role };
  } catch (error) {
    throw new AppError(ASK_USAGE, { cause: error });
  }
}
