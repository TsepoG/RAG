// @ts-check
import { friendlyLabel, validateCitations } from '../citations/index.js';

/**
 * A source the answer cites, with the label low-depth roles show instead of a file path.
 * @typedef {import('../citations/index.js').RegisteredSource & { friendlyLabel: string, inferred: boolean }} CitedSource
 */

/**
 * Something the model was given or shown but did not cite, for the "also consulted" list.
 * @typedef {object} ConsultedItem
 * @property {string} [key] - The key, when the model was given the full source.
 * @property {'confluence' | 'github'} type - Where it is.
 * @property {string} title - What to call it.
 * @property {string} url - Link to it.
 */

/**
 * What a question produced, in the shape the web UI will stream later.
 * @typedef {object} AnswerParts
 * @property {string} answer - The answer, with invented citation keys removed.
 * @property {string} role - The id of the role it was written for.
 * @property {CitedSource[]} sources - The sources the answer cites, in key order. A source is
 *   `inferred` when every citation of it carries the asterisk.
 * @property {ConsultedItem[]} alsoConsulted - Fetched sources it did not cite, then search hits it
 *   did not fetch, without repeats, at most ten.
 * @property {string[]} invalidKeys - Keys the answer used that were never registered.
 * @property {string[]} uncitedSourceKeys - Keys of fetched sources the answer did not cite.
 * @property {string[]} inferredKeys - Keys cited with an asterisk (the model's interpretation).
 */

/** Most entries in the "also consulted" list. */
export const MAX_ALSO_CONSULTED = 10;

/**
 * Builds the list of things consulted but not cited.
 * @param {import('../citations/index.js').RegisteredSource[]} uncited - Fetched, uncited sources.
 * @param {import('../citations/index.js').Candidate[]} candidates - Search hits and list items.
 * @param {ReadonlyArray<string>} citedUrls - Links of cited sources, which are not repeated here.
 * @returns {ConsultedItem[]} The list.
 */
function buildAlsoConsulted(uncited, candidates, citedUrls) {
  const seen = new Set(citedUrls);
  /** @type {ConsultedItem[]} */
  const items = [];
  /**
   * Adds an item unless its link is already listed or cited.
   * @param {ConsultedItem} item - The item.
   */
  const add = (item) => {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      items.push(item);
    }
  };
  uncited.forEach(({ key, type, title, url }) => add({ key, type, title, url }));
  candidates.forEach(({ type, title, url }) => add({ type, title, url }));
  return items.slice(0, MAX_ALSO_CONSULTED);
}

/**
 * Turns the model's answer and what was fetched into the parts of the final result: checks the
 * citations, and works out which sources are cited and which were only consulted.
 * @param {{ answer: string, role: { id: string }, registry: import('../citations/index.js').CitationRegistry }} input
 *   The raw answer, the role it was written for, and the question's registry.
 * @returns {AnswerParts} The checked answer and its sources.
 */
export function assembleAnswer({ answer, role, registry }) {
  const checked = validateCitations(answer, registry);
  const all = registry.list();
  const cited = new Set(checked.citedKeys);
  const sources = all
    .filter(({ key }) => cited.has(key))
    .map((source) => ({
      ...source,
      friendlyLabel: friendlyLabel(source),
      inferred:
        checked.inferredKeys.includes(source.key) && !checked.statedKeys.includes(source.key),
    }));
  const uncited = all.filter(({ key }) => !cited.has(key));
  return {
    answer: checked.answer,
    role: role.id,
    sources,
    alsoConsulted: buildAlsoConsulted(
      uncited,
      registry.candidates(),
      sources.map(({ url }) => url),
    ),
    invalidKeys: checked.invalidKeys,
    uncitedSourceKeys: checked.uncitedSourceKeys,
    inferredKeys: checked.inferredKeys,
  };
}
