// @ts-check
import { describeFailure } from './api.js';

/**
 * One line of a CODEOWNERS file.
 * @typedef {object} CodeownersRule
 * @property {string} pattern - Which paths the line covers.
 * @property {string[]} owners - Who owns them; empty when the line takes ownership away.
 */

/**
 * Looks up who owns a file, from the repository's CODEOWNERS file.
 * @typedef {object} CodeownersLookup
 * @property {(repo: string, path: string) => Promise<string[]>} ownersOf - The owners of a path,
 *   exactly as written in the file (`@user`, `@org/team` or an email). Empty when there is no
 *   CODEOWNERS file, no rule for the path, the repository is not allowed, or the lookup failed.
 *   It never throws, and reads each repository's file at most once.
 */

/** Where GitHub looks for the file, in the order it prefers them. */
export const CODEOWNERS_LOCATIONS = Object.freeze([
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
]);

const MAX_FILE_LENGTH = 100_000;
const MAX_RULES = 5000;
const COMMENT_MARK = '#';
const SECTION_START = '[';
const NEGATION = '!';
const WILDCARDS = ['*', '?'];

/**
 * Reads the rules of a CODEOWNERS file. Comments, blank lines, section headers and negated
 * patterns (which GitHub does not support) are skipped.
 * @param {string} text - The file.
 * @returns {CodeownersRule[]} The rules, in file order.
 */
export function parseCodeowners(text) {
  /** @type {CodeownersRule[]} */
  const rules = [];
  for (const line of text.slice(0, MAX_FILE_LENGTH).split('\n')) {
    const code = line.split(` ${COMMENT_MARK}`)[0].trim();
    if (
      code === '' ||
      [COMMENT_MARK, SECTION_START, NEGATION].some((mark) => code.startsWith(mark))
    ) {
      continue;
    }
    const [pattern, ...words] = code.split(/\s+/);
    rules.push({ pattern, owners: words.filter((word) => word.includes('@')) });
    if (rules.length >= MAX_RULES) {
      break;
    }
  }
  return rules;
}

/**
 * Whether a name matches a pattern with `*` (any characters) and `?` (one character).
 * @param {string} pattern - One segment of a rule's pattern.
 * @param {string} name - One segment of a path.
 * @returns {boolean} True when they match.
 */
function globMatches(pattern, name) {
  let p = 0;
  let n = 0;
  let star = -1;
  let resume = 0;
  while (n < name.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === name[n])) {
      p += 1;
      n += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      resume = n;
      p += 1;
    } else if (star !== -1) {
      p = star + 1;
      resume += 1;
      n = resume;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') {
    p += 1;
  }
  return p === pattern.length;
}

/**
 * How a rule's pattern is read.
 * @typedef {object} PatternShape
 * @property {string[]} segments - The pattern split at slashes.
 * @property {boolean} anchored - Whether it must start at the top of the repository.
 * @property {boolean} directory - Whether it names a directory, with a slash at the end.
 * @property {boolean} contents - Whether files beneath a match count too: for a directory, or a
 *   plain name that could be one. A wildcard in the last part (`docs/*`) means files directly there.
 */

/**
 * Reads a pattern the way GitHub does, which is close to a .gitignore line.
 * @param {string} pattern - The pattern.
 * @returns {PatternShape} How to match it.
 */
function readPattern(pattern) {
  const segments = pattern.split('/').filter((part) => part !== '');
  const directory = pattern.endsWith('/');
  const last = segments.at(-1) ?? '';
  return {
    segments,
    anchored: pattern.startsWith('/') || segments.length > 1,
    directory,
    contents: directory || !WILDCARDS.some((wildcard) => last.includes(wildcard)),
  };
}

/**
 * Matches the rest of a pattern against the rest of a path.
 * @param {PatternShape} shape - The pattern.
 * @param {number} at - Which part of the pattern is next.
 * @param {string[]} names - The parts of the path.
 * @param {number} from - Which part of the path is next.
 * @returns {boolean} True when they match.
 */
function matchesFrom(shape, at, names, from) {
  if (at === shape.segments.length) {
    return from === names.length ? !shape.directory : shape.contents;
  }
  if (shape.segments[at] === '**') {
    for (let next = from; next <= names.length; next += 1) {
      if (matchesFrom(shape, at + 1, names, next)) {
        return true;
      }
    }
    return false;
  }
  return (
    from < names.length &&
    globMatches(shape.segments[at], names[from]) &&
    matchesFrom(shape, at + 1, names, from + 1)
  );
}

/**
 * Whether a rule covers a path.
 * @param {string} pattern - The rule's pattern.
 * @param {string[]} names - The parts of the path.
 * @returns {boolean} True when it does.
 */
function covers(pattern, names) {
  const shape = readPattern(pattern);
  if (shape.segments.length === 0) {
    return false;
  }
  const starts = shape.anchored ? [0] : names.map((_, index) => index);
  return starts.some((start) => matchesFrom(shape, 0, names, start));
}

/**
 * Finds the owners of a path. As in GitHub, the last rule that covers the path decides, and a rule
 * with no owners means the path has none.
 * @param {string} path - A file path in the repository.
 * @param {ReadonlyArray<CodeownersRule>} rules - The rules, in file order.
 * @returns {string[]} The owners, or an empty list.
 */
export function matchOwners(path, rules) {
  const names = path.split('/').filter((part) => part !== '');
  const decisive = rules.findLast(({ pattern }) => covers(pattern, names));
  return decisive === undefined ? [] : [...decisive.owners];
}

/**
 * Encodes a path for a request URL.
 * @param {string} path - The path.
 * @returns {string} The path with each part encoded.
 */
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Creates the lookup for one question. Each repository's file is read at most once, from the first
 * of GitHub's three places that has one, so at most three requests per repository.
 * @param {{ api: Pick<import('./api.js').GithubApi, 'getRaw'>, repos: ReadonlyArray<string>, logger?: Pick<import('../logger/index.js').Logger, 'warn'> }} options
 *   The GitHub client, the allowed repositories, and where failures are logged.
 * @returns {CodeownersLookup} The lookup.
 */
export function createCodeownersLookup({ api, repos, logger }) {
  const allowed = new Map(repos.map((repo) => [repo.toLowerCase(), repo]));
  /** @type {Map<string, Promise<CodeownersRule[]>>} */
  const files = new Map();

  /**
   * Reads and parses the repository's file.
   * @param {string} repo - `owner/repo`, as configured.
   * @returns {Promise<CodeownersRule[]>} The rules; empty if there is no file or it cannot be read.
   */
  async function load(repo) {
    try {
      for (const location of CODEOWNERS_LOCATIONS) {
        const text = await api.getRaw(`/repos/${repo}/contents/${encodePath(location)}`);
        if (text !== undefined) {
          return parseCodeowners(text);
        }
      }
    } catch (error) {
      // Only the repository and the kind of failure are logged, never the file or its owners.
      logger?.warn({ repo, reason: describeFailure(error) }, 'could not read CODEOWNERS');
    }
    return [];
  }

  return {
    async ownersOf(repo, path) {
      const configured = allowed.get(repo.toLowerCase());
      if (configured === undefined) {
        logger?.warn({ repo }, 'refused to read CODEOWNERS of a repository that is not allowed');
        return [];
      }
      let loading = files.get(configured);
      if (loading === undefined) {
        loading = load(configured);
        files.set(configured, loading);
      }
      return matchOwners(path, await loading);
    },
  };
}
