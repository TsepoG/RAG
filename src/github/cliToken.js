// @ts-check
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildGithubCliEnv, DEFAULT_GITHUB_CLI } from '../config/index.js';
import { GithubSignInRequiredError } from '../errors/index.js';
import { maskSecrets } from '../logger/index.js';

/** The longest one gh command may take. */
export const GH_TIMEOUT_MS = 5000;

/** How long a token read from gh is reused before gh is asked again. */
export const TOKEN_CACHE_MS = 5 * 60_000;

/** Prints the CLI's token for github.com. Never `--show-token`, which is for `gh auth status`. */
export const TOKEN_ARGS = Object.freeze(['auth', 'token', '--hostname', 'github.com']);

/** Prints the login of the account the token belongs to. */
export const LOGIN_ARGS = Object.freeze(['api', 'user', '--jq', '.login']);

// The errors execFile gives when the program cannot be started at all.
const NOT_STARTED = new Set(['ENOENT', 'EINVAL']);

const DETAIL_CHARS = 200;

/**
 * Runs a program without a shell. The same shape as node's promisified execFile.
 * @typedef {(file: string, args: ReadonlyArray<string>, options: { env: Record<string, string>, timeout: number, windowsHide: boolean, shell: false }) => Promise<{ stdout: string, stderr: string }>} ExecFile
 */

/**
 * Gives the token of the person's GitHub CLI login, and the login's name. It never writes the token
 * anywhere, and the token never goes into a log line or an error message.
 * @typedef {object} CliTokenProvider
 * @property {(options?: { fresh?: boolean }) => Promise<string>} getGithubToken - The token. Reused
 *   for five minutes unless `fresh` is set; asked for again when a turn starts, so a logout or an
 *   account switch is seen at once. Throws GithubSignInRequiredError when there is none.
 * @property {() => void} invalidate - Forgets the token, after GitHub refused it.
 * @property {() => Promise<string | undefined>} getLogin - The account's login, or undefined when
 *   gh cannot say. Asked once for each token.
 */

/**
 * Turns a failed gh command into the reason the person has to act, keeping gh's own words out of
 * the message.
 * @param {unknown} error - What execFile threw.
 * @returns {GithubSignInRequiredError} The error to throw.
 */
function signInError(error) {
  const code = /** @type {{ code?: unknown }} */ (error).code;
  const reason = typeof code === 'string' && NOT_STARTED.has(code) ? 'cli-missing' : 'logged-out';
  return new GithubSignInRequiredError(reason, { cause: error });
}

/**
 * Creates the provider for gh-cli mode.
 * @param {object} deps - What it works with, all replaceable in tests.
 * @param {string} [deps.cliPath] - The gh program: GITHUB_CLI_PATH, or `gh`.
 * @param {ExecFile} [deps.execFile] - Runs a program; node's execFile by default.
 * @param {Record<string, string>} [deps.env] - The environment gh runs in; this process's, without
 *   the variables that would replace the gh login, by default.
 * @param {{ now: () => number }} [deps.clock] - The time source.
 * @param {number} [deps.ttlMs] - How long a token is reused.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} [deps.logger] - Where failures are logged.
 * @returns {CliTokenProvider} The provider.
 */
export function createCliTokenProvider({
  // Found through PATH unless GITHUB_CLI_PATH names the program. That is the CLI's own
  // installation, run without a shell and with fixed arguments; set GITHUB_CLI_PATH to pin it.
  cliPath = DEFAULT_GITHUB_CLI,
  execFile = promisify(nodeExecFile),
  env = buildGithubCliEnv(),
  clock = { now: () => Date.now() },
  ttlMs = TOKEN_CACHE_MS,
  logger,
} = {}) {
  const options = Object.freeze({
    env,
    timeout: GH_TIMEOUT_MS,
    windowsHide: true,
    shell: /** @type {const} */ (false),
  });
  /** @type {{ token: string, until: number } | undefined} */
  let cached;
  /** @type {Promise<string> | undefined} */
  let reading;
  /** @type {{ token: string, login: string | undefined } | undefined} */
  let known;

  /**
   * Runs gh with fixed arguments.
   * @param {ReadonlyArray<string>} args - The arguments.
   * @returns {Promise<string>} What it printed, trimmed.
   */
  async function gh(args) {
    const { stdout } = await execFile(cliPath, args, options);
    return stdout.trim();
  }

  /**
   * Logs why gh failed, with anything shaped like a token masked.
   * @param {unknown} error - What execFile threw.
   * @param {string} reason - The reason given to the person.
   * @param {string} message - What is being said.
   */
  function warn(error, reason, message) {
    const stderr = /** @type {{ stderr?: unknown }} */ (error).stderr;
    const text = typeof stderr === 'string' && stderr !== '' ? stderr : String(error);
    logger?.warn({ reason, detail: maskSecrets(text, [], DETAIL_CHARS) }, message);
  }

  /**
   * Asks gh for the token and keeps it.
   * @returns {Promise<string>} The token.
   */
  async function read() {
    let token;
    try {
      token = await gh(TOKEN_ARGS);
    } catch (error) {
      const failure = signInError(error);
      warn(error, failure.reason, 'could not get a token from the GitHub CLI');
      throw failure;
    }
    if (token === '') {
      throw new GithubSignInRequiredError('logged-out');
    }
    cached = { token, until: clock.now() + ttlMs };
    return token;
  }

  /**
   * Reads the token, sharing one gh run among callers that ask at the same time.
   * @returns {Promise<string>} The token.
   */
  function readOnce() {
    reading ??= read().finally(() => {
      reading = undefined;
    });
    return reading;
  }

  return {
    async getGithubToken({ fresh = false } = {}) {
      if (!fresh && cached !== undefined && clock.now() < cached.until) {
        return cached.token;
      }
      return readOnce();
    },
    invalidate() {
      cached = undefined;
    },
    async getLogin() {
      const token = cached?.token ?? (await readOnce());
      if (known?.token === token) {
        return known.login;
      }
      let login;
      try {
        login = (await gh(LOGIN_ARGS)) || undefined;
      } catch (error) {
        // The name is only shown on the page; without it the panel says "GitHub (GitHub CLI)".
        warn(error, 'login', 'could not read the GitHub CLI account name');
        return undefined;
      }
      known = { token, login };
      return login;
    },
  };
}
