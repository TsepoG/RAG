// @ts-check

/**
 * What the helper needs, all injected so tests make no network calls.
 * @typedef {object} GithubApiOptions
 * @property {string} token - The GitHub token (GITHUB_TOKEN); sent only in the Authorization header.
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
 * @param {GithubApiOptions} options - The token and an optional fetch.
 * @returns {GithubApi} The client.
 */
export function createGithubApi({ token, fetch: fetchFunction = globalThis.fetch }) {
  /**
   * Makes one GET request.
   * @param {string} path - The path under the API root.
   * @param {string} accept - The media type to ask for.
   * @returns {Promise<Response>} The response.
   */
  function get(path, accept) {
    return fetchFunction(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
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
