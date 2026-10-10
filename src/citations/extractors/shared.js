// @ts-check

/**
 * What an extractor is given: the call's arguments and the result, as the post-tool hook sees them.
 * @typedef {object} ExtractInput
 * @property {unknown} args - The arguments the tool was called with.
 * @property {string} text - The text the model is given for the result.
 * @property {string} [log] - The result's session log, which for a file also names its resource
 *   URI. Optional: the SDK does not promise it.
 */

/**
 * What an extractor may need to know, none of it read from the environment.
 * @typedef {object} ExtractContext
 * @property {string} siteUrl - The Atlassian site, as `https://<site>.atlassian.net`.
 * @property {ReadonlyArray<string>} spaceKeys - Confluence spaces whose content may be used.
 * @property {ReadonlyArray<string>} repos - GitHub repositories (`owner/repo`) that may be used.
 * @property {() => number} now - The current time in milliseconds.
 * @property {(repo: string) => Promise<string | undefined>} resolveHead - Looks up the head commit of
 *   a repository's default branch; undefined when it cannot be found.
 */

/**
 * What an extractor found in one result.
 * @typedef {object} Extraction
 * @property {import('../registry.js').Source[]} sources - Sources the model was given, to cite.
 * @property {import('../registry.js').Candidate[]} candidates - Hits it was not given in full.
 * @property {boolean} blocked - True when the content must not reach the model.
 * @property {string} [reason] - Why it was blocked or why nothing was found, for the log.
 */

/**
 * An extractor: reads one tool's result and says what it holds.
 * @typedef {(input: ExtractInput, context: ExtractContext) => Promise<Extraction>} Extractor
 */

/** Most search hits or list items kept as candidates from one result. */
export const MAX_CANDIDATES = 10;

const MAX_TITLE_LENGTH = 80;
const FULL_SHA = /^[0-9a-f]{40}$/;
const GITHUB_REPO_IN_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\//;
const MONTHS_BEFORE_STALE = 12;

/**
 * Builds the result for content that must not reach the model.
 * @param {string} reason - Why, for the log; never the content.
 * @returns {Extraction} A blocked extraction.
 */
export function blocked(reason) {
  return { sources: [], candidates: [], blocked: true, reason };
}

/**
 * Builds the result for something that holds nothing to cite, with the reason.
 * @param {string} reason - Why nothing was found, for the log.
 * @returns {Extraction} An empty extraction.
 */
export function nothing(reason) {
  return { sources: [], candidates: [], blocked: false, reason };
}

/**
 * Parses JSON, giving undefined for text that is not JSON.
 * @param {string} text - The text.
 * @returns {unknown} The value, or undefined.
 */
export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Reads a value as a plain object.
 * @param {unknown} value - Any value.
 * @returns {Record<string, unknown>} The object, or an empty one for anything else.
 */
export function asObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Reads a value as a string.
 * @param {unknown} value - Any value.
 * @returns {string} The string, or an empty string for anything else.
 */
export function asString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Whether text is a full 40-character commit-style SHA.
 * @param {unknown} value - Any value.
 * @returns {boolean} True for 40 lower-case hex characters.
 */
export function isFullSha(value) {
  return typeof value === 'string' && FULL_SHA.test(value);
}

/**
 * Finds the repository a GitHub URL points into.
 * @param {string} url - A github.com URL.
 * @returns {string | undefined} `owner/repo`, or undefined for any other URL.
 */
export function repoFromUrl(url) {
  return GITHUB_REPO_IN_URL.exec(url)?.[1];
}

/**
 * Reads `owner` and `repo` from tool arguments.
 * @param {unknown} args - The tool arguments.
 * @returns {string | undefined} `owner/repo`, or undefined when either is missing.
 */
export function repoFromArguments(args) {
  const { owner, repo } = asObject(args);
  return typeof owner === 'string' && typeof repo === 'string' ? `${owner}/${repo}` : undefined;
}

/**
 * Whether a repository is one of the allowed ones, ignoring case.
 * @param {ReadonlyArray<string>} repos - The allowed repositories.
 * @param {string | undefined} repo - The repository.
 * @returns {boolean} True when it is allowed.
 */
export function isAllowedRepo(repos, repo) {
  return (
    repo !== undefined && repos.some((allowed) => allowed.toLowerCase() === repo.toLowerCase())
  );
}

/**
 * Shortens a commit message to its first line.
 * @param {string} message - The message.
 * @returns {string} The first line, cut to a reasonable length.
 */
export function firstLine(message) {
  const [line] = message.split('\n');
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
}

/**
 * Whether a date is more than twelve months before now.
 * @param {string | undefined} date - An ISO date, when known.
 * @param {number} now - The current time in milliseconds.
 * @returns {boolean} True when it is older than that; false when the date is missing or invalid.
 */
export function isOlderThanAYear(date, now) {
  const then = date === undefined ? Number.NaN : Date.parse(date);
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() - MONTHS_BEFORE_STALE);
  return then < limit.getTime();
}
