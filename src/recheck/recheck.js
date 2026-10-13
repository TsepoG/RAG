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
 * @property {{ check: (source: import('../citations/index.js').ConfluenceSource & { fingerprint: string }) => Promise<import('./github.js').CheckStatus> }} confluence - Pages.
 * @property {{ now: () => number }} clock - Time source.
 */

/**
 * Whether a source can be checked: only one with a fingerprint can be compared with what is live.
 * A commit, or a single release, never changes, so it has none and is left out.
 * @param {import('../citations/index.js').RegisteredSource} source - The source.
 * @returns {source is import('../citations/index.js').RegisteredSource & { fingerprint: string }} True when it has a fingerprint.
 */
function isCheckable(source) {
  return source.fingerprint !== undefined;
}

/**
 * Checks sources against the live Confluence and GitHub, without using Copilot. The checks run
 * together, and a source that cannot be checked says so rather than failing the rest.
 * @param {ReadonlyArray<import('../citations/index.js').RegisteredSource>} sources - The sources.
 * @param {Checkers} checkers - The checkers and a clock.
 * @returns {Promise<CheckResult[]>} A result for each checkable source, in the order given.
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
