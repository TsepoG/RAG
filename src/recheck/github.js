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
 * @property {(source: import('../citations/index.js').GithubSource) => Promise<CheckStatus>} check - Checks one file, folder or list of releases.
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
 *
 * A source is compared with what the model read: the fingerprint stored when it was fetched, looked
 * at again in the same ref the model read (the default branch when it named none). A source with no
 * stored fingerprint is compared with itself at the commit its link is pinned to, which takes a
 * second request; with no commit either, there is nothing to compare, and it is `unavailable`,
 * never `changed`.
 * @param {object} deps - What it needs.
 * @param {Pick<import('../github/index.js').GithubApi, 'getJson'>} deps.api - The GitHub client.
 * @param {ReadonlyArray<string>} deps.repos - The repositories it may ask about (GITHUB_REPOS).
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} deps.logger - Where failures are logged.
 * @returns {GithubChecker} The checker.
 */
export function createGithubChecker({ api, repos, logger }) {
  const allowed = new Set(repos.map((repo) => repo.toLowerCase()));

  /**
   * Fetches what a source is at a ref, as a fingerprint.
   * @param {import('../citations/index.js').GithubSource} source - The source.
   * @param {string | undefined} ref - A branch, tag or commit; the default branch when undefined.
   * @returns {Promise<string | undefined>} The fingerprint, or undefined when the answer is not recognised.
   */
  async function fingerprintAt({ kind, repo, path }, ref) {
    if (kind === 'releases') {
      return fingerprintReleases(await api.getJson(`/repos/${repo}/releases?per_page=1`));
    }
    const query = ref === undefined ? '' : `?ref=${encodeURIComponent(ref)}`;
    return fingerprintContents(
      await api.getJson(`/repos/${repo}/contents/${encodePath(path)}${query}`),
    );
  }

  /**
   * Finds what the model read: the stored fingerprint, or the source at its pinned commit.
   * @param {import('../citations/index.js').GithubSource} source - The source.
   * @returns {Promise<string | undefined>} The fingerprint, or undefined when there is nothing to compare with.
   */
  async function baselineOf(source) {
    if (source.fingerprint !== undefined) {
      return source.fingerprint;
    }
    // A list of releases has no commit to look at it in.
    const lookable = source.kind !== 'releases' && source.commitSha !== '';
    return lookable ? fingerprintAt(source, source.commitSha) : undefined;
  }

  /**
   * Compares the source as it is now with what the model read.
   * @param {import('../citations/index.js').GithubSource} source - The source.
   * @param {string} baseline - What the model read.
   * @returns {Promise<CheckStatus>} The status.
   */
  async function compareWithLive(source, baseline) {
    try {
      const live = await fingerprintAt(source, source.ref);
      if (live === undefined) {
        // An answer that cannot be read tells nothing, so it does not count as a change.
        return 'unavailable';
      }
      return live === baseline ? 'unchanged' : 'changed';
    } catch (error) {
      if (isNotFound(error)) {
        // It was read once, so its being gone now is a change to what was read.
        return 'changed';
      }
      throw error;
    }
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
        const baseline = await baselineOf(source);
        return baseline === undefined ? 'unavailable' : await compareWithLive(source, baseline);
      } catch (error) {
        logger.warn(
          { kind: source.kind, reason: describeFailure(error) },
          'could not re-check a source',
        );
        return 'unavailable';
      }
    },
  };
}
