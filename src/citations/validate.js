// @ts-check
import { isKeyShaped } from './registry.js';

/**
 * What checking an answer's citations found.
 * @typedef {object} ValidationResult
 * @property {string} answer - The answer, with invented keys removed and combined brackets split.
 * @property {string[]} citedKeys - Registered keys the answer cites, in order of first use.
 * @property {string[]} invalidKeys - Keys that look like citations but are not registered.
 * @property {string[]} uncitedSourceKeys - Registered keys the answer never cites, in key order.
 * @property {string[]} inferredKeys - Cited keys marked as the model's interpretation with an
 *   asterisk, such as `[G1*]`, in order of first use. A key can be here and in `statedKeys`.
 * @property {string[]} statedKeys - Cited keys used at least once without an asterisk.
 */

// A bracket that could hold citation keys: only the letters of keys, digits, commas, asterisks
// and spaces. A space before it goes with it when the bracket is removed, so no stray gap is left.
const CITATION_BRACKET = /(\s?)\[([CG\d,\s*]+)\]/g;
const INFERRED_MARK = '*';

/**
 * One key as written in a bracket.
 * @typedef {object} WrittenKey
 * @property {string} key - The key, such as `G1`.
 * @property {boolean} inferred - Whether it carried the asterisk.
 */

/**
 * Splits the inside of a bracket into keys, or says it is not a list of keys.
 * @param {string} inside - The text between the brackets.
 * @returns {WrittenKey[] | undefined} The keys, or undefined when any part is not shaped like a key.
 */
export function parseCitationKeys(inside) {
  const written = inside.split(',').map((part) => {
    const text = part.trim();
    const inferred = text.endsWith(INFERRED_MARK);
    return { key: inferred ? text.slice(0, -1).trim() : text, inferred };
  });
  return written.every(({ key }) => isKeyShaped(key)) ? written : undefined;
}

/**
 * Writes a key the way it appears in the answer.
 * @param {WrittenKey} written - The key.
 * @returns {string} The bracketed key, such as `[G1*]`.
 */
function bracket({ key, inferred }) {
  return `[${key}${inferred ? INFERRED_MARK : ''}]`;
}

/**
 * Adds a value to a list unless it is already there.
 * @param {string[]} list - The list, changed in place.
 * @param {string} value - The value.
 */
function addOnce(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

/**
 * Checks the citations in an answer against what was actually fetched. A key that is not in the
 * registry is removed and reported; nothing else in the answer is changed, except that a bracket
 * with several keys, such as `[C1, G2]`, is written as `[C1][G2]`. An asterisk, as in `[G1*]`,
 * marks a statement as the model's interpretation: it is kept in the answer and reported.
 * @param {string} answer - The model's answer.
 * @param {{ get: (key: string) => unknown, list: () => Array<{ key: string }> }} registry - The
 *   registry of this question's sources.
 * @returns {ValidationResult} The cleaned answer and what was found.
 */
export function validateCitations(answer, registry) {
  /** @type {string[]} */
  const cited = [];
  /** @type {string[]} */
  const invalid = [];
  /** @type {string[]} */
  const inferred = [];
  /** @type {string[]} */
  const stated = [];

  const cleaned = answer.replace(CITATION_BRACKET, (whole, space, inside) => {
    const keys = parseCitationKeys(inside);
    if (keys === undefined) {
      return whole;
    }
    const valid = keys.filter(({ key }) => registry.get(key) !== undefined);
    keys
      .filter(({ key }) => registry.get(key) === undefined)
      .forEach(({ key }) => addOnce(invalid, key));
    /** @type {WrittenKey[]} */
    const unique = [];
    valid.forEach((written) => {
      if (
        !unique.some(({ key, inferred: mark }) => key === written.key && mark === written.inferred)
      ) {
        unique.push(written);
      }
      addOnce(cited, written.key);
      addOnce(written.inferred ? inferred : stated, written.key);
    });
    return unique.length === 0 ? '' : `${space}${unique.map(bracket).join('')}`;
  });

  return {
    answer: cleaned,
    citedKeys: cited,
    invalidKeys: invalid,
    uncitedSourceKeys: registry
      .list()
      .map(({ key }) => key)
      .filter((key) => !cited.includes(key)),
    inferredKeys: inferred,
    statedKeys: stated,
  };
}
