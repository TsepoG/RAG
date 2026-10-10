// @ts-check
import { loadConfig, loadEnvFileIfPresent } from '../config/index.js';
import { ConfigError } from '../errors/index.js';
import { createCopilotClient, ensureAuthenticated } from '../copilot/index.js';
import { createLogger } from '../logger/index.js';

/** Exit code for configuration, sign-in and Copilot failures, and for a missing question. */
export const EXIT_FAILURE = 1;

/** Exit code for a question that ran out of time. */
export const EXIT_TIMEOUT = 2;

/**
 * Turns an error into the one-line message shown to the user. A ConfigError already lists every
 * problem, so its cause would only repeat them as raw JSON.
 * @param {import('../errors/index.js').AppError} error - The error to describe.
 * @returns {string} The message, with the cause's message on a second line when there is one.
 */
export function describeError(error) {
  const { cause } = error;
  const detail =
    !(error instanceof ConfigError) && cause instanceof Error
      ? `\n  caused by: ${cause.message}`
      : '';
  return `${error.message}${detail}`;
}

/**
 * Loads config and a logger that writes to stderr, so stdout carries only the command's output.
 * @returns {{ config: import('../config/index.js').AppConfig, logger: import('../logger/index.js').Logger }}
 *   The validated config and the logger.
 * @throws {ConfigError} When the environment is invalid.
 */
export function loadSettings() {
  loadEnvFileIfPresent();
  const config = loadConfig();
  const logger = createLogger({
    level: config.logLevel,
    name: 'cli',
    destination: process.stderr,
  });
  return { config, logger };
}

/**
 * Starts Copilot, checks that it is signed in, runs the work, and always stops the client.
 * @template T
 * @param {{ config: import('../config/index.js').AppConfig, logger: import('../logger/index.js').Logger }} settings
 *   Config and logger from {@link loadSettings}.
 * @param {(handle: import('../copilot/client.js').CopilotHandle) => Promise<T>} work - Uses the
 *   started client.
 * @returns {Promise<T>} Whatever `work` returns.
 * @throws {import('../errors/index.js').AppError} When Copilot cannot start, is not signed in, or `work` fails.
 */
export async function withCopilot({ config, logger }, work) {
  const handle = await createCopilotClient(config, { logger });
  try {
    await ensureAuthenticated(handle.client);
    return await work(handle);
  } finally {
    await handle.stop();
  }
}
