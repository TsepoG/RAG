// @ts-check
import { GithubSignInRequiredError } from '../errors/index.js';

/**
 * What the helper needs, all injected so tests make no network calls.
 * @typedef {object} GithubApiOptions
 * @property {string} [token] - The GitHub token (GITHUB_TOKEN, token mode); sent only in the
 *   Authorization header.
 * @property {() => Promise<string>} [getToken] - Gives the token for each request, instead of a
 *   fixed one: the GitHub CLI's token, in gh-cli mode.
 * @property {() => void} [invalidate] - Forgets the token once GitHub refuses it (gh-cli mode).
 *   When it is given, a 401 is tried once more with a fresh token and then reported as
 *   GithubSignInRequiredError, and a 403 that needs single sign-on is reported as such. Without it,
 *   every failure is reported as before.
 * @property {typeof fetch} [fetch] - The fetch function; defaults to the global one.
 */

/**
 * A read-only client for the few GitHub REST endpoints the application uses. Every request is a
 * GET with a time limit, and the token goes nowhere except the Authorization header.
 * @typedef {object} GithubApi
 * @property {(path: string) => Promise<Record<string, unknown>>} getJson - Gets a JSON document.
 *   Throws an Error whose message is "GitHub answered <status>" when the answer is not a success.
 * @property {(path: string) => Promise<string | undefined>} getRaw - Gets a file's text, or
 *   undefined when GitHub answers 404. Throws like `getJson` for any other failure.
 */

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'role-aware-assistant';
const REQUEST_TIMEOUT_MS = 10_000;
const NOT_FOUND = 404;
const JSON_ACCEPT = 'application/vnd.github+json';
const RAW_ACCEPT = 'application/vnd.github.raw+json';
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
// GitHub sets this on a 403 when the organisation needs the token authorised for single sign-on.
const SSO_HEADER = 'x-github-sso';

/**
 * Reads a value as a plain object.
 * @param {unknown} value - Any value.
 * @returns {Record<string, unknown>} The object, or an empty one.
 */
function asObject(value) {
  return typeof value === 'object' && value !== null
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Creates the client.
 * @param {GithubApiOptions} options - The token, or how to get one, and an optional fetch.
 * @returns {GithubApi} The client.
 */
export function createGithubApi({
  token,
  // Token mode always gives a token; gh-cli mode gives getToken instead.
  getToken = async () => /** @type {string} */ (token),
  invalidate,
  fetch: fetchFunction = globalThis.fetch,
}) {
  /**
   * Makes one GET request.
   * @param {string} path - The path under the API root.
   * @param {string} accept - The media type to ask for.
   * @returns {Promise<Response>} The response.
   */
  async function send(path, accept) {
    return fetchFunction(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        Accept: accept,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  /**
   * Makes one GET request. In gh-cli mode a refused token is replaced once, so a new login is
   * picked up, and a token GitHub still refuses, or one that needs single sign-on, becomes a
   * sign-in error the page can explain.
   * @param {string} path - The path under the API root.
   * @param {string} accept - The media type to ask for.
   * @returns {Promise<Response>} The response.
   * @throws {GithubSignInRequiredError} In gh-cli mode, when GitHub refuses the token.
   */
  async function get(path, accept) {
    let response = await send(path, accept);
    if (invalidate === undefined) {
      return response;
    }
    if (response.status === UNAUTHORIZED) {
      invalidate();
      response = await send(path, accept);
      if (response.status === UNAUTHORIZED) {
        // Forgotten again, so the next request asks the CLI once more.
        invalidate();
        throw new GithubSignInRequiredError('logged-out');
      }
    }
    if (response.status === FORBIDDEN && response.headers.has(SSO_HEADER)) {
      throw new GithubSignInRequiredError('sso');
    }
    return response;
  }

  /**
   * Stops on a failed response.
   * @param {Response} response - The response.
   * @throws {Error} When the status is not a success.
   */
  function ensureOk(response) {
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`);
    }
  }

  return {
    async getJson(path) {
      const response = await get(path, JSON_ACCEPT);
      ensureOk(response);
      return asObject(await response.json());
    },
    async getRaw(path) {
      const response = await get(path, RAW_ACCEPT);
      if (response.status === NOT_FOUND) {
        return undefined;
      }
      ensureOk(response);
      return response.text();
    },
  };
}

/**
 * Says what went wrong without repeating anything the failing call carried. Our own errors have a
 * message written here; any other, such as a network or parsing error, is named by its type only.
 * @param {unknown} error - What was thrown.
 * @returns {string} A short reason for the log.
 */
export function describeFailure(error) {
  if (!(error instanceof Error)) {
    return 'unknown';
  }
  return error.name === 'Error' ? error.message : error.name;
}

/** The message `getJson` and `getRaw` fail with when GitHub answers 404. */
const NOT_FOUND_MESSAGE = `GitHub answered ${NOT_FOUND}`;

/**
 * Whether a failure of the client is GitHub saying the thing is not there.
 * @param {unknown} error - What was thrown.
 * @returns {boolean} True for a 404.
 */
export function isNotFound(error) {
  return error instanceof Error && error.message === NOT_FOUND_MESSAGE;
}
