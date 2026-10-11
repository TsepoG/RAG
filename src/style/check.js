// @ts-check
import { findCitationBrackets } from '../honesty/index.js';

/**
 * One way an answer does not suit the role it was written for.
 * @typedef {object} StyleViolation
 * @property {'code-block' | 'inline-code' | 'file-path' | 'banned-term'} type - The kind of problem.
 * @property {string} message - It, in plain words, for the rewrite request and the result.
 */

/** The part of a role the check reads. */
/** @typedef {{ depth: number, bannedTerms: ReadonlyArray<string> }} StyleRole */

const FENCE = '```';
const META_INFO = 'answer-meta';
const BACKTICK = '`';
/** Roles at or below this depth see no code, inline code or file paths. */
const NO_CODE_DEPTH = 1;
/** Roles at or below this depth see no code blocks. */
const NO_CODE_BLOCK_DEPTH = 2;
const MAX_LISTED = 3;
const MAX_EXTENSION_LENGTH = 5;
// Folders that mean a token with a slash is a path in a code base.
const SOURCE_FOLDERS = ['src/', 'lib/', 'app/', 'test/', 'tests/', 'docs/', '.github/'];
const TOKEN_EDGES = '()[]{}<>"\',;:!?*_';
const PLURAL_ENDINGS = ['', 's', 'es'];
// An extension is letters and digits with at least one letter, so "3.5" is not a file.
const ALPHANUMERIC = /^[a-z\d]+$/i;
const LETTER = /[a-z]/i;

/**
 * Takes the fenced code out of an answer. The answer-meta block is not part of the answer, so it
 * is dropped without counting.
 * @param {string} answer - The answer.
 * @returns {{ prose: string, codeBlocks: number }} The text outside the fences, and how many
 *   fenced blocks (other than answer-meta) there were.
 */
function splitFences(answer) {
  const prose = [];
  let codeBlocks = 0;
  let inFence = false;
  for (const line of answer.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(FENCE)) {
      if (!inFence && trimmed.replace(/^`+/, '').trim().toLowerCase() !== META_INFO) {
        codeBlocks += 1;
      }
      inFence = !inFence;
    } else if (!inFence) {
      prose.push(line);
    }
  }
  return { prose: prose.join('\n'), codeBlocks };
}

/**
 * Finds the inline code spans of a text and returns the text without them.
 * @param {string} prose - Text outside code fences.
 * @returns {{ text: string, spans: string[] }} The text with spans taken out, and the spans.
 */
function splitInlineCode(prose) {
  /** @type {string[]} */
  const spans = [];
  const lines = prose.split('\n').map((line) => {
    const parts = line.split(BACKTICK);
    // An odd number of parts means the backticks pair up; otherwise they are just text.
    if (parts.length < 3 || parts.length % 2 === 0) {
      return line;
    }
    parts.forEach((part, index) => {
      if (index % 2 === 1 && part !== '' && !spans.includes(part)) {
        spans.push(part);
      }
    });
    return parts.filter((_, index) => index % 2 === 0).join(' ');
  });
  return { text: lines.join('\n'), spans };
}

/**
 * Takes the citation brackets out of a text, because they are not part of how it is written.
 * @param {string} text - The text.
 * @returns {string} The text without brackets.
 */
function withoutCitations(text) {
  let result = '';
  let from = 0;
  findCitationBrackets(text).forEach(({ start, end }) => {
    result += `${text.slice(from, start)} `;
    from = end;
  });
  return `${result}${text.slice(from)}`;
}

/**
 * Whether a word is a file path: a slash and either a file extension or a source folder.
 * @param {string} token - A word of the answer, with its edge marks removed.
 * @returns {boolean} True for a path such as `src/refunds/policy.ts` or `docs/guide`.
 */
function isFilePath(token) {
  if (!token.includes('/') || token.includes('://')) {
    return false;
  }
  if (SOURCE_FOLDERS.some((folder) => token.startsWith(folder))) {
    return true;
  }
  const name = token.slice(token.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const extension = name.slice(dot + 1);
  return (
    dot > 0 &&
    extension.length <= MAX_EXTENSION_LENGTH &&
    ALPHANUMERIC.test(extension) &&
    LETTER.test(extension)
  );
}

/**
 * Removes the marks around a word, and a full stop that ends a sentence.
 * @param {string} word - A word cut at whitespace.
 * @returns {string} The word.
 */
function trimEdges(word) {
  let from = 0;
  let to = word.length;
  while (from < to && TOKEN_EDGES.includes(word[from])) {
    from += 1;
  }
  while (to > from && (TOKEN_EDGES.includes(word[to - 1]) || word[to - 1] === '.')) {
    to -= 1;
  }
  return word.slice(from, to);
}

/**
 * Finds the file paths in a text.
 * @param {string} text - Text without code or citations.
 * @returns {string[]} The distinct paths, in order.
 */
function findFilePaths(text) {
  const found = text
    .split(/\s+/)
    .map(trimEdges)
    .filter((token) => isFilePath(token));
  return [...new Set(found)];
}

/**
 * Whether a character can be part of a word.
 * @param {string | undefined} character - One character, or undefined past an end.
 * @returns {boolean} True for a letter, digit or underscore.
 */
function isWordCharacter(character) {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

/**
 * Whether a text uses a banned word, ignoring case and matching whole words. A plain plural
 * ("endpoints", "classes") counts as the word.
 * @param {string} lowerText - The text in lower case.
 * @param {string} term - The banned term.
 * @returns {boolean} True when the word is used.
 */
function usesWord(lowerText, term) {
  const needle = term.toLowerCase();
  let at = lowerText.indexOf(needle);
  while (at !== -1) {
    const after = at + needle.length;
    const startsWord = !isWordCharacter(lowerText[at - 1]);
    const endsWord = PLURAL_ENDINGS.some(
      (ending) =>
        lowerText.startsWith(ending, after) && !isWordCharacter(lowerText[after + ending.length]),
    );
    if (startsWord && endsWord) {
      return true;
    }
    at = lowerText.indexOf(needle, at + 1);
  }
  return false;
}

/**
 * Lists a few items for a message.
 * @param {ReadonlyArray<string>} items - The items.
 * @returns {string} At most three, with a note when there are more.
 */
function listSome(items) {
  const shown = items.slice(0, MAX_LISTED).join(', ');
  return items.length > MAX_LISTED ? `${shown} and ${items.length - MAX_LISTED} more` : shown;
}

/**
 * Checks an answer against what its role allows, so a business answer with code in it is caught
 * before it is shown. Citations, links and the answer-meta block are not part of the check.
 * - Depth 1: no code blocks, inline code, file paths or banned words.
 * - Depth 2: no code blocks or banned words.
 * - Depth 3: banned words only.
 * @param {string} answer - The answer, with or without its answer-meta block.
 * @param {StyleRole} role - The role's depth and banned terms.
 * @returns {StyleViolation[]} What is wrong, empty when the answer suits the role.
 */
export function checkStyle(answer, role) {
  /** @type {StyleViolation[]} */
  const violations = [];
  const { prose, codeBlocks } = splitFences(answer);
  if (codeBlocks > 0 && role.depth <= NO_CODE_BLOCK_DEPTH) {
    violations.push({ type: 'code-block', message: 'it contains a code block' });
  }
  const { text: noInline, spans } = splitInlineCode(prose);
  const text = withoutCitations(noInline);
  if (role.depth <= NO_CODE_DEPTH) {
    if (spans.length > 0) {
      violations.push({ type: 'inline-code', message: `it uses inline code (${listSome(spans)})` });
    }
    const paths = findFilePaths(text);
    if (paths.length > 0) {
      violations.push({ type: 'file-path', message: `it shows file paths (${listSome(paths)})` });
    }
  }
  const lower = `${text}\n${spans.join('\n')}`.toLowerCase();
  role.bannedTerms
    .filter((term) => usesWord(lower, term))
    .forEach((term) => {
      violations.push({ type: 'banned-term', message: `it uses the word "${term}"` });
    });
  return violations;
}
