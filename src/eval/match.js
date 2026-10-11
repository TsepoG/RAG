// @ts-check

/**
 * A source the answer cited, as far as matching needs it.
 * @typedef {object} CitedSourceLike
 * @property {'confluence' | 'github'} type - Where it is.
 * @property {string} title - What it is called.
 * @property {string} [id] - The page id, for a Confluence page.
 * @property {string} [repo] - `owner/repo`, for a GitHub source.
 * @property {string} [path] - The file or folder path, for a GitHub source.
 * @property {boolean} [inferred] - Whether every citation of it carries the asterisk.
 */

/**
 * A source an eval case expects, or forbids, in the answer's citations.
 * @typedef {{ type: 'confluence' | 'github', match: string }} SourceExpectation
 */

/**
 * Whether a cited source is the one an expectation describes. A Confluence page matches by its id
 * or a fragment of its title; a GitHub source by a fragment of `owner/repo/path` or of its title.
 * Fragments are compared without regard to case.
 * @param {CitedSourceLike} source - What the answer cited.
 * @param {SourceExpectation} expected - What the case describes.
 * @returns {boolean} True when they are the same source.
 */
export function sourceMatches(source, { type, match }) {
  if (source.type !== type) {
    return false;
  }
  const wanted = match.toLowerCase();
  const contains = (/** @type {string} */ text) => text.toLowerCase().includes(wanted);
  if (type === 'confluence') {
    return source.id === match || contains(source.title);
  }
  return contains(`${source.repo ?? ''}/${source.path ?? ''}`) || contains(source.title);
}

/**
 * Splits expectations into those the answer cited and those it did not.
 * @param {ReadonlyArray<SourceExpectation>} expected - What the case describes.
 * @param {ReadonlyArray<CitedSourceLike>} cited - What the answer cited.
 * @returns {{ found: SourceExpectation[], missed: SourceExpectation[] }} Each expectation, once.
 */
export function partitionExpected(expected, cited) {
  /** @type {SourceExpectation[]} */
  const found = [];
  /** @type {SourceExpectation[]} */
  const missed = [];
  for (const wanted of expected) {
    (cited.some((source) => sourceMatches(source, wanted)) ? found : missed).push(wanted);
  }
  return { found, missed };
}
