// @ts-check
import { isKeyShaped } from './registry.js';

/**
 * What checking an answer's citations found.
 * @typedef {object} ValidationResult
 * @property {string} answer - The answer, with invented keys removed and combined brackets split.
 * @property {string[]} citedKeys - Registered keys the answer cites, in order of first use.
 * @property {string[]} invalidKeys - Keys that look like citations but are not registered.
 * @property {string[]} uncitedSourceKeys - Registered keys the answer never cites, in key order.
 */

// A bracket that could hold citation keys: only the letters of keys, digits, commas and spaces. A
// space before it goes with it when the bracket is removed, so no stray gap is left in the text.
const CITATION_BRACKET = /(\s?)\[([CG\d,\s]+)\]/g;

/**
 * Splits the inside of a bracket into keys, or says it is not a list of keys.
 * @param {string} inside - The text between the brackets.
 * @returns {string[] | undefined} The keys, or undefined when any part is not shaped like a key.
 */
function parseKeys(inside) {
  const parts = inside.split(',').map((part) => part.trim());
  return parts.every(isKeyShaped) ? parts : undefined;
}

/**
 * Checks the citations in an answer against what was actually fetched. A key that is not in the
 * registry is removed and reported; nothing else in the answer is changed, except that a bracket
 * with several keys, such as `[C1, G2]`, is written as `[C1][G2]`.
 * @param {string} answer - The model's answer.
 * @param {{ get: (key: string) => unknown, list: () => Array<{ key: string }> }} registry - The
 *   registry of this question's sources.
 * @returns {ValidationResult} The cleaned answer and what was found.
 */
export function validateCitations(answer, registry) {
  /** @type {Set<string>} */
  const cited = new Set();
  /** @type {Set<string>} */
  const invalid = new Set();

  const cleaned = answer.replace(CITATION_BRACKET, (whole, space, inside) => {
    const keys = parseKeys(inside);
    if (keys === undefined) {
      return whole;
    }
    const valid = [...new Set(keys.filter((key) => registry.get(key) !== undefined))];
    keys.filter((key) => !valid.includes(key)).forEach((key) => invalid.add(key));
    valid.forEach((key) => cited.add(key));
    const written = valid.map((key) => `[${key}]`).join('');
    return valid.length === 0 ? '' : `${space}${written}`;
  });

  return {
    answer: cleaned,
    citedKeys: [...cited],
    invalidKeys: [...invalid],
    uncitedSourceKeys: registry
      .list()
      .map(({ key }) => key)
      .filter((key) => !cited.has(key)),
  };
}
