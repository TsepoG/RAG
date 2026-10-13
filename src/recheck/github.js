// @ts-check
import { blobFingerprint, entriesFingerprint, releaseListFingerprint } from '../citations/index.js';
import { describeFailure, isNotFound } from '../github/index.js';

/**
 * What a re-check found out about one source.
 * @typedef {'unchanged' | 'changed' | 'unavailable'} CheckStatus
 */

/**
 * Looks at the live GitHub and says whether a source is still what the model read. It makes only
 * read-only GET requests, only to the repositories the application is allowed to read, and never
 * throws: a source that cannot be checked is `unavailable`, and the reason (never a path, a token
 * or any content) is logged.
 * @typedef {object} GithubChecker
 * @property {(source: import('../citations/index.js').GithubSource & { fingerprint: string }) => Promise<CheckStatus>} check - Checks one file, folder or list of releases.
 */

/**
 * Encodes a path for a URL, keeping its slashes.
 * @param {string} path - A path in a repository.
 * @returns {string} The encoded path.
 */
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

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
 * Reads a value as text.
 * @param {unknown} value - Any value.
 * @returns {string} The text, or an empty string.
 */
function asString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Fingerprints the answer the contents API gives for a path: a file, or a folder's entries. The
 * fingerprints are made by the same functions the extractors use, so they can be compared.
 * @param {unknown} answer - What the contents API answered.
 * @returns {string | undefined} The fingerprint, or undefined when the answer is not recognised.
 */
function fingerprintContents(answer) {
  if (Array.isArray(answer)) {
    const entries = answer.map((entry) => ({
      name: asString(asObject(entry).name),
      sha: asString(asObject(entry).sha),
    }));
    return entries.every(({ name, sha }) => name !== '' && sha !== '')
      ? entriesFingerprint(entries)
      : undefined;
  }
  const sha = asString(asObject(answer).sha);
  return sha === '' ? undefined : blobFingerprint(sha);
}

/**
 * Fingerprints the answer the releases API gives: the newest tag.
 * @param {unknown} answer - What the releases API answered, newest first.
 * @returns {string | undefined} The fingerprint, or undefined when there is no release to name.
 */
function fingerprintReleases(answer) {
  const newest = Array.isArray(answer) ? asObject(answer[0]) : {};
  const tag = asString(newest.tag_name) || asString(newest.name);
  return tag === '' ? undefined : releaseListFingerprint(tag);
}

/**
 * Creates the checker.
 * @param {object} deps - What it needs.
 * @param {Pick<import('../github/index.js').GithubApi, 'getJson'>} deps.api - The GitHub client.
 * @param {ReadonlyArray<string>} deps.repos - The repositories it may ask about (GITHUB_REPOS).
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} deps.logger - Where failures are logged.
 * @returns {GithubChecker} The checker.
 */
export function createGithubChecker({ api, repos, logger }) {
  const allowed = new Set(repos.map((repo) => repo.toLowerCase()));

  /**
   * Fetches what the source is now, as a fingerprint. A file or folder that is gone has none.
   * @param {import('../citations/index.js').GithubSource} source - The source.
   * @returns {Promise<string | undefined>} The fingerprint now.
   */
  async function liveFingerprint({ kind, repo, path }) {
    if (kind === 'releases') {
      return fingerprintReleases(await api.getJson(`/repos/${repo}/releases?per_page=1`));
    }
    return fingerprintContents(await api.getJson(`/repos/${repo}/contents/${encodePath(path)}`));
  }

  return {
    async check(source) {
      if (!allowed.has(source.repo.toLowerCase())) {
        logger.warn(
          { kind: source.kind },
          'did not re-check a source outside the allowed repositories',
        );
        return 'unavailable';
      }
      try {
        const live = await liveFingerprint(source);
        if (live === undefined) {
          // An answer that cannot be read tells nothing, so it does not count as a change.
          return 'unavailable';
        }
        return live === source.fingerprint ? 'unchanged' : 'changed';
      } catch (error) {
        if (isNotFound(error)) {
          // The file or folder is no longer there, which is a change to what was read.
          return 'changed';
        }
        logger.warn(
          { kind: source.kind, reason: describeFailure(error) },
          'could not re-check a source',
        );
        return 'unavailable';
      }
    },
  };
}
