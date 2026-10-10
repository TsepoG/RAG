// @ts-check

/**
 * Outcome of a scope check. A denial carries a short code for the log and a reason that is sent
 * back to the model so it can correct the call.
 * @typedef {{ ok: true } | { ok: false, code: string, reason: string }} ScopeResult
 */

/**
 * What a question may touch, in the form the checks need.
 * @typedef {object} Scope
 * @property {ReadonlySet<string>} repos - Allowed `owner/repo` names, lower-cased.
 * @property {ReadonlySet<string>} spaceKeys - Allowed Confluence space keys, lower-cased.
 * @property {string} siteUrl - Origin of the Atlassian site, lower-cased.
 */

/**
 * Names of the arguments the checks read. Each must exist in docs/mcp-tools.md; a test reads that
 * file, so a rename on the server shows up as a failing test instead of a silent bypass.
 */
export const ARGUMENTS = Object.freeze({
  owner: 'owner',
  repo: 'repo',
  query: 'query',
  cql: 'cql',
  cqlContext: 'cqlcontext',
  contentId: 'content_id',
  contentUrl: 'content_url',
});

/** The result of a check that passed. */
export const OK = Object.freeze({ ok: /** @type {const} */ (true) });

/**
 * Builds a denial.
 * @param {string} code - Short code for the log.
 * @param {string} reason - Explanation for the model.
 * @returns {ScopeResult} A denial.
 */
export function deny(code, reason) {
  return { ok: false, code, reason };
}

/**
 * Reads tool arguments as a plain object; anything else counts as no arguments.
 * @param {unknown} args - The arguments as the runtime reports them.
 * @returns {Record<string, unknown>} The arguments.
 */
export function asRecord(args) {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? /** @type {Record<string, unknown>} */ (args)
    : {};
}

/**
 * Whether a value is a string with something in it.
 * @param {unknown} value - Any value.
 * @returns {value is string} True for a non-blank string.
 */
export function isFilled(value) {
  return typeof value === 'string' && value.trim() !== '';
}
