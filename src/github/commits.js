// @ts-check

/**
 * What the resolver needs, all injected so tests make no network calls.
 * @typedef {object} CommitResolverOptions
 * @property {string} token - The GitHub token (GITHUB_TOKEN); sent only in the Authorization header.
 * @property {ReadonlyArray<string>} repos - Repositories the resolver may ask about (GITHUB_REPOS).
 * @property {typeof fetch} [fetch] - The fetch function; defaults to the global one.
 * @property {Pick<import('../logger/index.js').Logger, 'warn'>} [logger] - Where failures are logged.
 */

/**
 * Looks up commits so a file link can be pinned to an exact commit.
 * @typedef {object} CommitResolver
 * @property {(repo: string) => Promise<string | undefined>} resolveHead - The full SHA of the head
 *   commit of the repository's default branch, or undefined when it cannot be found. It never
 *   throws, answers each repository once, and refuses repositories that are not allowed.
 */

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'role-aware-assistant';
const REQUEST_TIMEOUT_MS = 10_000;
const FULL_SHA = /^[0-9a-f]{40}$/;

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
 * Says what went wrong without repeating anything the failing call carried. Our own errors have a
 * message written here; any other, such as a network or parsing error, is named by its type only.
 * @param {unknown} error - What was thrown.
 * @returns {string} A short reason for the log.
 */
function describeFailure(error) {
  if (!(error instanceof Error)) {
    return 'unknown';
  }
  return error.name === 'Error' ? error.message : error.name;
}

/**
 * Creates a resolver for one question. Each repository is looked up at most once, so a question
 * that reads many files from one repository makes two requests, not two per file.
 * @param {CommitResolverOptions} options - Token, allowed repositories, and fetch and logger.
 * @returns {CommitResolver} The resolver.
 */
export function createCommitResolver({
  token,
  repos,
  fetch: fetchFunction = globalThis.fetch,
  logger,
}) {
  // By lower-case name to the configured spelling, which is the one used in requests.
  const allowed = new Map(repos.map((repo) => [repo.toLowerCase(), repo]));
  /** @type {Map<string, Promise<string | undefined>>} */
  const lookups = new Map();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };

  /**
   * Gets one JSON document from the GitHub API.
   * @param {string} path - The path under the API root.
   * @returns {Promise<Record<string, unknown>>} The document.
   * @throws {Error} When the request fails or the answer is not a success.
   */
  async function getJson(path) {
    const response = await fetchFunction(`${API_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`);
    }
    return asObject(await response.json());
  }

  /**
   * Finds the head commit of the default branch.
   * @param {string} repo - `owner/repo`.
   * @returns {Promise<string | undefined>} The SHA, or undefined after logging why not.
   */
  async function lookUp(repo) {
    try {
      const { default_branch: branch } = await getJson(`/repos/${repo}`);
      if (typeof branch !== 'string' || branch === '') {
        throw new Error('no default branch in the answer');
      }
      const encoded = branch.split('/').map(encodeURIComponent).join('/');
      const { sha } = await getJson(`/repos/${repo}/commits/${encoded}`);
      if (typeof sha !== 'string' || !FULL_SHA.test(sha)) {
        throw new Error('no commit SHA in the answer');
      }
      return sha;
    } catch (error) {
      // Only the repository and the kind of failure are logged: nothing from the request.
      const reason = describeFailure(error);
      logger?.warn({ repo, reason }, 'could not look up the head commit');
      return undefined;
    }
  }

  return {
    resolveHead(repo) {
      const key = repo.toLowerCase();
      const configured = allowed.get(key);
      if (configured === undefined) {
        logger?.warn({ repo }, 'refused to look up a repository that is not allowed');
        return Promise.resolve(undefined);
      }
      const known = lookups.get(key);
      if (known !== undefined) {
        return known;
      }
      const lookup = lookUp(configured);
      lookups.set(key, lookup);
      return lookup;
    },
  };
}
