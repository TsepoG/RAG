// @ts-check
import { listSentences } from './prose.js';

/** Most uncited sentences the result reports; enough for Phase 6 to measure, small to log. */
export const MAX_UNCITED_SENTENCES = 5;

/** Longest an uncited sentence is reported before it is cut. */
export const MAX_REPORTED_LENGTH = 160;

/** A sentence shorter than this is not judged. */
const MIN_WORDS = 6;
const ELLIPSIS = '…';
const LEAD_IN_END = ':';

/**
 * Whether a sentence is a claim that needs a citation: long enough, and not a lead-in such as
 * "The main rules are:" that only introduces a list. Only sentences with no citation are asked.
 * @param {string} text - The sentence.
 * @returns {boolean} True when it should be cited.
 */
function needsCitation(text) {
  const words = text.split(/\s+/).filter((word) => word !== '');
  return !text.endsWith(LEAD_IN_END) && words.length >= MIN_WORDS;
}

/**
 * Cuts a sentence to the length that is reported.
 * @param {string} text - The sentence.
 * @returns {string} The sentence, or its start followed by an ellipsis.
 */
function shorten(text) {
  return text.length > MAX_REPORTED_LENGTH
    ? `${text.slice(0, MAX_REPORTED_LENGTH - 1).trimEnd()}${ELLIPSIS}`
    : text;
}

/**
 * Finds the sentences of an answer that make a claim without citing a source. Headings, the
 * sections the application writes itself, code, tables, list lead-ins ending in a colon and
 * sentences under six words are not judged. It is a heuristic by design.
 * @param {string} answer - The answer, after invalid keys were removed.
 * @returns {string[]} At most five sentences, each cut to 160 characters.
 */
export function findUncitedSentences(answer) {
  return listSentences(answer)
    .filter((sentence) => sentence.brackets.length === 0 && needsCitation(sentence.text))
    .slice(0, MAX_UNCITED_SENTENCES)
    .map(({ text }) => shorten(text));
}

/**
 * Finds the sentences whose citations are all of one kind of source.
 * @param {string} answer - The answer, after invalid keys were removed.
 * @param {(key: string) => boolean} isKind - Whether a key is of that kind.
 * @returns {Array<import('./prose.js').Sentence>} The sentences that cite something and cite
 *   only keys of that kind.
 */
function sentencesCitingOnlyKind(answer, isKind) {
  return listSentences(answer).filter(
    ({ brackets }) =>
      brackets.length > 0 && brackets.every(({ keys }) => keys.every(({ key }) => isKind(key))),
  );
}

/**
 * Finds the sentences whose only citations are of one kind of source, such as folder listings.
 * @param {string} answer - The answer, after invalid keys were removed.
 * @param {(key: string) => boolean} isKind - Whether a key is of that kind.
 * @returns {string[]} The sentences, in order.
 */
export function sentencesCitingOnly(answer, isKind) {
  return sentencesCitingOnlyKind(answer, isKind).map(({ text }) => text);
}

/**
 * Marks the citations of the sentences that only cite one kind of source as the model's
 * interpretation, by adding an asterisk: `[G3]` becomes `[G3*]`. A folder listing shows which files
 * exist, not what is in them, so a sentence resting on nothing else is an inference.
 * @param {string} answer - The answer, after invalid keys were removed.
 * @param {(key: string) => boolean} isKind - Whether a key is of that kind.
 * @returns {{ answer: string, sentences: string[] }} The answer with the marks added, and the
 *   sentences that were marked. The answer is unchanged when there are none.
 */
export function markCitationsAsInferred(answer, isKind) {
  const marked = sentencesCitingOnlyKind(answer, isKind);
  let result = '';
  let from = 0;
  marked
    .flatMap(({ brackets }) => brackets)
    .forEach(({ start, end, keys }) => {
      const written = keys.map(({ key }) => `[${key}*]`).join('');
      result += `${answer.slice(from, start)}${written}`;
      from = end;
    });
  return { answer: `${result}${answer.slice(from)}`, sentences: marked.map(({ text }) => text) };
}
