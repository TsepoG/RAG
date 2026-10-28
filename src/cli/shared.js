// @ts-check
import { loadConfig, loadEnvFileIfPresent } from '../config/index.js';
import {
  createStoredTokenProvider,
  MIN_TURN_TOKEN_MARGIN_MS,
  SIGN_IN_FIRST,
} from '../atlassian/index.js';
import { AppError, ConfigError } from '../errors/index.js';
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

/**
 * In oauth mode, gives the commands the sign-in made in the web app; in the other modes, nothing.
 * @param {{ config: import('../config/index.js').AppConfig, logger: import('../logger/index.js').Logger }} settings
 *   Config and logger from {@link loadSettings}.
 * @returns {Promise<{ getAtlassianToken?: import('../atlassian/index.js').TokenProvider['getAtlassianToken'] }>}
 *   The way to get the token, in oauth mode.
 * @throws {AppError} In oauth mode, when nobody has signed in through the web app.
 */
export async function atlassianSignIn({ config, logger }) {
  const { auth } = config.atlassian;
  if (auth.mode !== 'oauth') {
    return {};
  }
  const provider = createStoredTokenProvider({ dir: auth.dir, logger });
  if (!(await provider.status()).signedIn) {
    throw new AppError(SIGN_IN_FIRST);
  }
  return { getAtlassianToken: provider.getAtlassianToken };
}

/**
 * The options for building the MCP servers' entries: in oauth mode, the signed-in token.
 * @param {{ config: import('../config/index.js').AppConfig, logger: import('../logger/index.js').Logger }} settings
 *   Config and logger from {@link loadSettings}.
 * @returns {Promise<import('../mcp/servers.js').McpServerOptions>} The options.
 * @throws {AppError} In oauth mode, when nobody has signed in through the web app.
 */
export async function serverOptions(settings) {
  const { getAtlassianToken } = await atlassianSignIn(settings);
  if (getAtlassianToken === undefined) {
    return {};
  }
  const { accessToken } = await getAtlassianToken({ minValidityMs: MIN_TURN_TOKEN_MARGIN_MS });
  return { atlassianToken: accessToken };
}
