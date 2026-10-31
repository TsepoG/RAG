// @ts-check
import { createGithubApi, describeFailure } from './api.js';

/**
 * What the resolver needs, all injected so tests make no network calls.
 * @typedef {object} CommitResolverOptions
 * @property {string} [token] - The GitHub token (GITHUB_TOKEN); sent only in the Authorization
 *   header. Needed only when no `api` is given.
 * @property {ReadonlyArray<string>} repos - Repositories the resolver may ask about (GITHUB_REPOS).
 * @property {typeof fetch} [fetch] - The fetch function; defaults to the global one.
 * @property {import('./api.js').GithubApi} [api] - The GitHub client to use, shared with other
 *   lookups; one is made from the token and fetch when omitted.
 * @property {Pick<import('../logger/index.js').Logger, 'warn'>} [logger] - Where failures are logged.
 */

/**
 * Looks up commits so a file link can be pinned to an exact commit.
 * @typedef {object} CommitResolver
 * @property {(repo: string) => Promise<string | undefined>} resolveHead - The full SHA of the head
 *   commit of the repository's default branch, or undefined when it cannot be found. It never
 *   throws, answers each repository once, and refuses repositories that are not allowed.
 */

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Creates a resolver for one question. Each repository is looked up at most once, so a question
 * that reads many files from one repository makes two requests, not two per file.
 * @param {CommitResolverOptions} options - Token, allowed repositories, and fetch and logger.
 * @returns {CommitResolver} The resolver.
 */
export function createCommitResolver({
  token,
  repos,
  fetch: fetchFunction,
  api = createGithubApi({ token, fetch: fetchFunction }),
  logger,
}) {
  const { getJson } = api;
  // By lower-case name to the configured spelling, which is the one used in requests.
  const allowed = new Map(repos.map((repo) => [repo.toLowerCase(), repo]));
  /** @type {Map<string, Promise<string | undefined>>} */
  const lookups = new Map();
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
