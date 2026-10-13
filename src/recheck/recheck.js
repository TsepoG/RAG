// @ts-check

/**
 * What a re-check found for one source.
 * @typedef {object} CheckResult
 * @property {string} key - The source's citation key.
 * @property {import('./github.js').CheckStatus} status - Whether it is the same, changed, or could not be checked.
 * @property {number} checkedAt - When the check finished, in ms.
 */

/**
 * The checkers, one per place a source can come from. Each looks at the live thing with read-only
 * requests and never throws.
 * @typedef {object} Checkers
 * @property {import('./github.js').GithubChecker} github - Files, folders and release lists.
 * @property {import('./confluence.js').ConfluenceChecker} confluence - Pages.
 * @property {{ now: () => number }} clock - Time source.
 */

/** The kinds of GitHub source that can change; a commit or a single release never does. */
const MUTABLE_KINDS = new Set(['file', 'directory', 'releases']);

/**
 * Whether a source is worth checking: a page, or a file, folder or list of releases. A commit, or a
 * single release, never changes.
 * @param {import('../citations/index.js').Source} source - The source.
 * @returns {boolean} True when a check could tell something.
 */
export function isCheckable(source) {
  return source.type === 'confluence' || MUTABLE_KINDS.has(source.kind);
}

/**
 * Checks sources against the live Confluence and GitHub, without using Copilot. The checks run
 * together, and a source that cannot be checked says so rather than failing the rest.
 * @param {ReadonlyArray<import('../citations/index.js').RegisteredSource>} sources - The sources.
 * @param {Checkers} checkers - The checkers and a clock.
 * @returns {Promise<CheckResult[]>} A result for each source that can change, in the order given.
 */
export async function recheckSources(sources, { github, confluence, clock }) {
  return Promise.all(
    sources.filter(isCheckable).map(async (source) => {
      const status =
        source.type === 'confluence' ? await confluence.check(source) : await github.check(source);
      return { key: source.key, status, checkedAt: clock.now() };
    }),
  );
}
