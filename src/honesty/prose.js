// @ts-check
import { parseCitationKeys } from '../citations/index.js';

/**
 * A stretch of the answer, as offsets into it.
 * @typedef {object} Range
 * @property {number} start - First character.
 * @property {number} end - One past the last character.
 */

/**
 * A citation bracket in the answer, such as `[C1]` or `[C1][G2*]` (one bracket each).
 * @typedef {Range & { keys: import('../citations/index.js').WrittenKey[] }} CitationBracket
 */

/**
 * One sentence of prose and the citations inside it.
 * @typedef {Range & { text: string, brackets: CitationBracket[] }} Sentence
 */

const TERMINATORS = '.!?';
// Closing marks that may follow the full stop: `(see below.)`, `"done."`, `**done.**`.
const CLOSERS = ')"\'*_';
// Marks that may start a sentence besides a capital letter or a digit.
const OPENERS = '[`"\'(*_';
const FENCE = '```';
const TABLE_MARK = '|';
const HEADING_MARK = '#';
const LIST_MARKERS = ['- ', '* ', '+ '];
const MAX_LABEL_LENGTH = 50;
// Short forms whose full stop does not end a sentence.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'cf', 'approx', 'incl', 'eg', 'ie']);
// What the application renders itself from the structured report, so the model's own version of
// these sections is not checked. A heading may continue after the title; a bare label may not.
const SKIPPED_TITLES = [
  "what i couldn't confirm",
  'what i could not confirm',
  "what i don't know",
  'known gaps',
  'gaps',
  'conflicts',
  'open questions',
  'not confirmed',
];
const TITLE_NOISE = '#*_>-: \t';

/**
 * Finds a citation bracket that starts at a position.
 * @param {string} text - The answer.
 * @param {number} open - Where the `[` is.
 * @param {number} limit - The end of the stretch being read.
 * @returns {CitationBracket | undefined} The bracket, or undefined when it is not a citation.
 */
function bracketAt(text, open, limit) {
  const close = text.indexOf(']', open);
  if (text[open] !== '[' || close === -1 || close >= limit) {
    return undefined;
  }
  const keys = parseCitationKeys(text.slice(open + 1, close));
  return keys === undefined ? undefined : { start: open, end: close + 1, keys };
}

/**
 * Finds every citation bracket in a text.
 * @param {string} text - The text.
 * @returns {CitationBracket[]} The brackets, in order.
 */
export function findCitationBrackets(text) {
  /** @type {CitationBracket[]} */
  const found = [];
  let open = text.indexOf('[');
  while (open !== -1) {
    const bracket = bracketAt(text, open, text.length);
    open = text.indexOf('[', bracket === undefined ? open + 1 : bracket.end);
    if (bracket !== undefined) {
      found.push(bracket);
    }
  }
  return found;
}

/**
 * Strips the marks around a heading or label so it can be compared with the known titles.
 * @param {string} line - A trimmed line.
 * @returns {string} The title in lower case, with typographic apostrophes made plain.
 */
function normaliseTitle(line) {
  let from = 0;
  let to = line.length;
  while (from < to && TITLE_NOISE.includes(line[from])) {
    from += 1;
  }
  while (to > from && TITLE_NOISE.includes(line[to - 1])) {
    to -= 1;
  }
  return line.slice(from, to).toLowerCase().replaceAll('’', "'");
}

/**
 * How many characters of a trimmed line are a list marker, or 0 when it is not a list item.
 * @param {string} line - A trimmed line.
 * @returns {number} The length of the marker and the space after it.
 */
function listMarkerLength(line) {
  if (LIST_MARKERS.some((marker) => line.startsWith(marker))) {
    return 2;
  }
  let digits = 0;
  while (digits < line.length && line[digits] >= '0' && line[digits] <= '9') {
    digits += 1;
  }
  const after = line[digits];
  return digits > 0 && (after === '.' || after === ')') && line[digits + 1] === ' '
    ? digits + 2
    : 0;
}

/**
 * Says what kind of line a trimmed line is, for finding prose.
 * @param {string} trimmed - The line without surrounding space.
 * @returns {'fence' | 'blank' | 'table' | 'heading' | 'label' | 'text'} The kind.
 */
function classifyLine(trimmed) {
  if (trimmed.startsWith(FENCE)) {
    return 'fence';
  }
  if (trimmed === '') {
    return 'blank';
  }
  if (trimmed.startsWith(TABLE_MARK)) {
    return 'table';
  }
  if (trimmed.startsWith(HEADING_MARK)) {
    return 'heading';
  }
  const isLabel =
    trimmed.length <= MAX_LABEL_LENGTH && SKIPPED_TITLES.includes(normaliseTitle(trimmed));
  return isLabel ? 'label' : 'text';
}

/**
 * Where reading is in a section the application writes itself. A heading's section runs to the
 * next heading; a bare label's runs to the first blank line after its content.
 * @typedef {object} SkipState
 * @property {'heading' | 'label' | undefined} mode - The kind of section, if inside one.
 * @property {boolean} seen - Whether a line of content of a label's section has been passed.
 */

/** Not inside a section that is skipped. */
const NOT_SKIPPING = Object.freeze({ mode: undefined, seen: false });

/**
 * Moves through the skipped sections by one line.
 * @param {SkipState} state - Where reading was.
 * @param {'blank' | 'table' | 'heading' | 'label' | 'text'} kind - The kind of the line.
 * @param {string} trimmed - The line without surrounding space.
 * @returns {{ state: SkipState, hide: boolean }} Where reading is now, and whether this line is
 *   not prose to check (a heading, a table row, a blank line or a line of a skipped section).
 */
function advanceSkipping(state, kind, trimmed) {
  if (kind === 'blank') {
    return { state: state.mode === 'label' && state.seen ? NOT_SKIPPING : state, hide: true };
  }
  if (kind === 'heading') {
    const title = normaliseTitle(trimmed);
    const skipped = SKIPPED_TITLES.some((skippedTitle) => title.startsWith(skippedTitle));
    return { state: skipped ? { mode: 'heading', seen: false } : NOT_SKIPPING, hide: true };
  }
  if (state.mode === 'heading') {
    return { state, hide: true };
  }
  if (kind === 'label') {
    return { state: { mode: 'label', seen: false }, hide: true };
  }
  if (state.mode === 'label' && kind === 'text') {
    return { state: { mode: 'label', seen: true }, hide: true };
  }
  return { state, hide: kind !== 'text' };
}

/**
 * Finds the paragraphs and list items of the answer that are prose to be checked. Left out:
 * headings, fenced code, table rows, and the sections the application writes itself.
 * @param {string} answer - The answer.
 * @returns {Range[]} The stretches of prose, in order.
 */
export function findProse(answer) {
  /** @type {Range[]} */
  const found = [];
  /** @type {(Range & { list: boolean }) | undefined} */
  let open;
  let inFence = false;
  /** @type {SkipState} */
  let skipping = NOT_SKIPPING;
  let offset = 0;

  const close = () => {
    if (open !== undefined) {
      found.push({ start: open.start, end: open.end });
      open = undefined;
    }
  };

  /**
   * Adds a line of text to the current paragraph or list item, or starts a new one.
   * @param {string} trimmed - The line without surrounding space.
   * @param {number} start - Where the trimmed line starts in the answer.
   * @param {boolean} indented - Whether the line started with space.
   */
  const addText = (trimmed, start, indented) => {
    const marker = listMarkerLength(trimmed);
    const end = start + trimmed.length;
    if (open !== undefined && marker === 0 && (!open.list || indented)) {
      open.end = end;
      return;
    }
    close();
    open = { start: start + marker, end, list: marker > 0 };
  };

  for (const line of answer.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    const start = lineStart + (line.length - line.trimStart().length);
    const kind = classifyLine(trimmed);
    if (kind === 'fence' || inFence) {
      close();
      inFence = kind === 'fence' ? !inFence : inFence;
      continue;
    }
    const step = advanceSkipping(skipping, kind, trimmed);
    skipping = step.state;
    if (step.hide) {
      close();
    } else {
      addText(trimmed, start, start > lineStart);
    }
  }
  close();
  return found;
}

/**
 * Finds the citation brackets written after a full stop, which belong to the sentence before it.
 * @param {string} text - The answer.
 * @param {number} from - Where to start looking.
 * @param {number} limit - The end of the stretch being read.
 * @returns {number} Where the last such bracket ends, or `from` when there is none.
 */
function skipCitations(text, from, limit) {
  let stop = from;
  let next = from;
  for (;;) {
    while (next < limit && (text[next] === ' ' || text[next] === '\t')) {
      next += 1;
    }
    const bracket = bracketAt(text, next, limit);
    if (bracket === undefined) {
      return stop;
    }
    stop = bracket.end;
    next = stop;
  }
}

/**
 * Whether the word before a full stop is a short form, such as "e.g" or an initial.
 * @param {string} text - The answer.
 * @param {number} at - Where the full stop is.
 * @returns {boolean} True when the full stop does not end a sentence.
 */
function followsAbbreviation(text, at) {
  const wordStart = Math.max(text.lastIndexOf(' ', at), text.lastIndexOf('\n', at)) + 1;
  const word = text
    .slice(wordStart, at)
    .toLowerCase()
    .replace(/^[("'*_]+/, '');
  return ABBREVIATIONS.has(word) || (word.length === 1 && text[at] === '.');
}

/**
 * Whether the text after a sentence's end starts a new sentence.
 * @param {string} text - The answer.
 * @param {number} from - Where the space after the sentence starts.
 * @param {number} limit - The end of the stretch being read.
 * @returns {boolean} True at the end, or before a capital, a digit or an opening mark.
 */
function startsSentence(text, from, limit) {
  let next = from;
  while (next < limit && /\s/.test(text[next])) {
    next += 1;
  }
  const first = text[next] ?? '';
  return (
    next >= limit ||
    first !== first.toLowerCase() ||
    (first >= '0' && first <= '9') ||
    OPENERS.includes(first)
  );
}

/**
 * Whether a full stop at a position ends a sentence, and where the sentence stops.
 * @param {string} text - The answer.
 * @param {number} at - Where the full stop, question mark or exclamation mark is.
 * @param {number} limit - The end of the stretch being read.
 * @returns {number | undefined} Where the sentence ends (after any citations that follow), or
 *   undefined when the mark does not end one.
 */
function sentenceEnd(text, at, limit) {
  if (TERMINATORS.includes(text[at + 1] ?? '')) {
    return undefined;
  }
  let after = at + 1;
  while (after < limit && CLOSERS.includes(text[after])) {
    after += 1;
  }
  if ((after < limit && !/\s/.test(text[after])) || followsAbbreviation(text, at)) {
    return undefined;
  }
  const stop = skipCitations(text, after, limit);
  return stop > after || startsSentence(text, after, limit) ? stop : undefined;
}

/**
 * Splits a stretch of prose into sentences.
 * @param {string} answer - The answer.
 * @param {Range} prose - The stretch to split.
 * @returns {Range[]} The sentences, trimmed, in order.
 */
function splitSentences(answer, prose) {
  /** @type {Range[]} */
  const sentences = [];
  let from = prose.start;

  const push = (/** @type {number} */ to) => {
    const text = answer.slice(from, to);
    const start = from + (text.length - text.trimStart().length);
    const end = from + text.trimEnd().length;
    if (end > start) {
      sentences.push({ start, end });
    }
    from = to;
  };

  let at = prose.start;
  while (at < prose.end) {
    const stop = TERMINATORS.includes(answer[at]) ? sentenceEnd(answer, at, prose.end) : undefined;
    if (stop === undefined) {
      at += 1;
    } else {
      push(stop);
      at = stop;
    }
  }
  push(prose.end);
  return sentences;
}

/**
 * Lists the paragraphs and list items of an answer's prose, each as its sentences with the
 * citations in them.
 * @param {string} answer - The answer, with invented keys already removed.
 * @returns {Sentence[][]} One list of sentences for each paragraph or list item, in order.
 */
export function listParagraphs(answer) {
  return findProse(answer).map((prose) =>
    splitSentences(answer, prose).map(({ start, end }) => {
      const text = answer.slice(start, end);
      const brackets = findCitationBrackets(text).map((bracket) => ({
        ...bracket,
        start: bracket.start + start,
        end: bracket.end + start,
      }));
      return { start, end, text, brackets };
    }),
  );
}

/**
 * Lists the sentences of an answer's prose, each with the citations in it.
 * @param {string} answer - The answer, with invented keys already removed.
 * @returns {Sentence[]} The sentences, in order.
 */
export function listSentences(answer) {
  return listParagraphs(answer).flat();
}
