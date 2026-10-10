// @ts-check
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';
import { buildRuntimeEnv } from '../config/index.js';
import { CopilotError } from '../errors/index.js';
import { CLIENT_NAME } from './session.js';
import { finishesWithin } from './timing.js';

/** @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions */
/** @typedef {Pick<import('../logger/index.js').Logger, 'warn'>} ClientLogger */

/**
 * Pieces of the client that touch the machine, replaceable in tests.
 * @typedef {object} ClientDeps
 * @property {ClientLogger} logger - Where cleanup problems are logged.
 * @property {typeof CopilotClient} [ClientClass] - The SDK client class.
 * @property {Record<string, string | undefined>} [env] - Environment to filter for the runtime;
 *   defaults to the process environment.
 * @property {(prefix: string) => Promise<string>} [makeTempRoot] - Creates the temp directory.
 * @property {(path: string) => Promise<unknown>} [makeDirectory] - Creates a directory.
 * @property {(path: string) => Promise<void>} [removeDirectory] - Removes a directory tree.
 * @property {number} [cleanupTimeoutMs] - Longest `stop()` waits for the directory to go.
 */

/**
 * A started client and what its owner needs to use and shut it down.
 * @typedef {object} CopilotHandle
 * @property {CopilotClient} client - The started client.
 * @property {string} workingDirectory - The empty directory sessions should run in.
 * @property {() => Promise<void>} stop - Stops the client and removes its temp directory. Safe to
 *   call more than once; never throws.
 */

const TEMP_PREFIX = 'role-aware-copilot-';
const DATA_DIRECTORY = 'home';
const WORK_DIRECTORY = 'work';
const RUNTIME_LOG_LEVEL = 'error';
const DEFAULT_CLEANUP_TIMEOUT_MS = 5000;
const REMOVE_RETRIES = 3;
const REMOVE_RETRY_DELAY_MS = 100;

/** Shown when Copilot has no credentials. */
export const AUTH_HELP =
  'Copilot is not signed in. Run "gh auth login" (or "copilot login"), or set COPILOT_GITHUB_TOKEN ' +
  'to a fine-grained token with the "Copilot Requests" permission.';

/**
 * Removes a directory tree. Retries because Windows may hold a file briefly after a process exits.
 * @param {string} path - Directory to remove.
 * @returns {Promise<void>} Resolves when it is gone.
 */
function removeTree(path) {
  return rm(path, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  });
}

/**
 * Builds the options for the SDK client. Pure.
 * "empty" mode switches off every ambient feature, so the runtime does nothing the app did not ask
 * for. Its data and working directories are throwaway, so no state outlives the run and it cannot
 * see this repository or the .env file. It gets a filtered environment, and its credential only
 * through an explicit option, so the MCP token can never be mistaken for it.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @param {{ baseDirectory: string, workingDirectory: string, env: Record<string, string> }} paths
 *   The throwaway directories and the filtered environment.
 * @returns {CopilotClientOptions} The client options.
 */
export function buildClientOptions(config, { baseDirectory, workingDirectory, env }) {
  const { githubToken } = config.copilot;
  return {
    mode: 'empty',
    baseDirectory,
    workingDirectory,
    env,
    logLevel: RUNTIME_LOG_LEVEL,
    clientInfo: { applicationName: CLIENT_NAME },
    ...(githubToken === undefined ? { useLoggedInUser: true } : { gitHubToken: githubToken }),
  };
}

/**
 * Removes the temp directory without ever failing or holding up exit. This is the one place
 * errors are deliberately swallowed: a locked file in a temp directory must not turn a finished
 * question into a failure. The problem is logged, and the OS clears temp directories eventually.
 * @param {string} root - The temp directory.
 * @param {Required<Pick<ClientDeps, 'removeDirectory' | 'cleanupTimeoutMs'>> & { logger: ClientLogger }} deps
 *   How to remove it, how long to wait, and where to log.
 * @returns {Promise<void>} Resolves once the directory is gone or the wait has run out.
 */
async function removeQuietly(root, { removeDirectory, cleanupTimeoutMs, logger }) {
  const removal = removeDirectory(root).catch((error) => {
    logger.warn({ err: error, directory: root }, 'could not remove the temporary directory');
  });
  if (!(await finishesWithin(removal, cleanupTimeoutMs))) {
    logger.warn({ directory: root }, 'temporary directory is still being removed; not waiting');
  }
}

/**
 * Creates and starts the Copilot client in a throwaway sandbox.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @param {ClientDeps} deps - Logger, and optionally replacements for the SDK and the file system.
 * @returns {Promise<CopilotHandle>} The started client; call `stop` when done.
 * @throws {CopilotError} When the runtime cannot be started; `cause` has the detail.
 */
export async function createCopilotClient(config, deps) {
  const {
    logger,
    ClientClass = CopilotClient,
    env,
    makeTempRoot = (prefix) => mkdtemp(prefix),
    makeDirectory = (path) => mkdir(path),
    removeDirectory = removeTree,
    cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  } = deps;
  const cleanup = { removeDirectory, cleanupTimeoutMs, logger };
  const root = await makeTempRoot(join(tmpdir(), TEMP_PREFIX));
  const baseDirectory = join(root, DATA_DIRECTORY);
  const workingDirectory = join(root, WORK_DIRECTORY);
  /** @type {CopilotClient | undefined} */
  let client;
  try {
    await makeDirectory(baseDirectory);
    await makeDirectory(workingDirectory);
    client = new ClientClass(
      buildClientOptions(config, { baseDirectory, workingDirectory, env: buildRuntimeEnv(env) }),
    );
    await client.start();
  } catch (error) {
    await Promise.allSettled([client?.stop(), removeQuietly(root, cleanup)]);
    throw new CopilotError('Could not start the Copilot runtime', { cause: error });
  }
  const started = client;
  /** @type {Promise<void> | undefined} */
  let stopping;
  const stopOnce = async () => {
    try {
      const errors = await started.stop();
      errors.forEach((err) => logger.warn({ err }, 'the Copilot client reported an error on stop'));
    } catch (error) {
      logger.warn({ err: error }, 'stopping the Copilot client failed');
    }
    await removeQuietly(root, cleanup);
  };
  return { client: started, workingDirectory, stop: () => (stopping ??= stopOnce()) };
}

/**
 * Checks that Copilot has credentials, so a missing login gives a clear message up front instead
 * of a failure in the middle of a question.
 * @param {Pick<CopilotClient, 'getAuthStatus'>} client - A started client.
 * @returns {Promise<import('@github/copilot-sdk').GetAuthStatusResponse>} The auth status.
 * @throws {CopilotError} When the status cannot be read, or Copilot is not signed in.
 */
export async function ensureAuthenticated(client) {
  /** @type {import('@github/copilot-sdk').GetAuthStatusResponse} */
  let status;
  try {
    status = await client.getAuthStatus();
  } catch (error) {
    throw new CopilotError('Could not check whether Copilot is signed in', { cause: error });
  }
  if (!status.isAuthenticated) {
    throw new CopilotError(AUTH_HELP);
  }
  return status;
}
