// @ts-check
import { ARGUMENTS, asRecord, deny, isFilled, OK } from './scopeCommon.js';

/** @typedef {import('./scopeCommon.js').Scope} Scope */
/** @typedef {import('./scopeCommon.js').ScopeResult} ScopeResult */

const CQL_ORDER = 'order';
const CQL_BY = 'by';
const CQL_FORBIDDEN_WORDS = new Set(['or', 'not']);
// Words that would start another clause, so they cannot appear in the sort fields.
const CQL_NOT_IN_SORT = new Set([...CQL_FORBIDDEN_WORDS, 'and']);
const CQL_TOKEN = String.raw`\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(!=|!~|<=|>=|[=~<>])|([(),])|([^\s"'(),=~!<>]+))`;

/**
 * One piece of a CQL string.
 * @typedef {{ type: 'string' | 'op' | 'punct' | 'word', value: string }} CqlToken
 */

/**
 * Splits CQL into tokens. Quoted strings are kept whole, so keywords inside them are ignored.
 * @param {string} cql - The CQL expression.
 * @returns {CqlToken[] | undefined} The tokens, or undefined when the text cannot be tokenized
 *   (an unterminated quote or a stray character).
 */
function tokenizeCql(cql) {
  const text = cql.trim();
  const pattern = new RegExp(CQL_TOKEN, 'y');
  /** @type {CqlToken[]} */
  const tokens = [];
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text);
    if (match === null) {
      return undefined;
    }
    const [, quoted, operator, punctuation, word] = match;
    if (quoted !== undefined) {
      tokens.push({ type: 'string', value: quoted.slice(1, -1) });
    } else if (operator !== undefined) {
      tokens.push({ type: 'op', value: operator });
    } else if (punctuation !== undefined) {
      tokens.push({ type: 'punct', value: punctuation });
    } else {
      tokens.push({ type: 'word', value: word });
    }
  }
  return tokens;
}

/**
 * Whether a token is a given keyword (case-insensitive).
 * @param {CqlToken | undefined} token - The token, if any.
 * @param {string} word - Lower-case keyword.
 * @returns {boolean} True for a bare word equal to the keyword.
 */
function isWord(token, word) {
  return token?.type === 'word' && token.value.toLowerCase() === word;
}

/**
 * Whether a token can be the value of a comparison.
 * @param {CqlToken | undefined} token - The token, if any.
 * @returns {token is CqlToken} True for a bare word or a quoted string.
 */
function isValue(token) {
  return token?.type === 'word' || token?.type === 'string';
}

/**
 * Splits off a trailing `order by` clause. What follows it must be sort fields only, so a filter
 * cannot be smuggled in after it.
 * @param {CqlToken[]} tokens - All tokens.
 * @returns {{ filter: CqlToken[], valid: boolean }} The filter part, and whether the sort part is
 *   plain field names.
 */
function splitOrderBy(tokens) {
  const at = tokens.findIndex(
    (token, index) => isWord(token, CQL_ORDER) && isWord(tokens[index + 1], CQL_BY),
  );
  if (at === -1) {
    return { filter: tokens, valid: true };
  }
  const sort = tokens.slice(at + 2);
  const isSortPart = (/** @type {CqlToken} */ token) =>
    (token.type === 'word' && !CQL_NOT_IN_SORT.has(token.value.toLowerCase())) ||
    (token.type === 'punct' && token.value === ',');
  return { filter: tokens.slice(0, at), valid: sort.length > 0 && sort.every(isSortPart) };
}

/**
 * Whether parentheses and commas appear only inside an `in (...)` list.
 * @param {CqlToken[]} tokens - The filter tokens.
 * @returns {boolean} True when they do, and every parenthesis is closed.
 */
function hasOnlyListParentheses(tokens) {
  let open = false;
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'punct') {
      continue;
    }
    if (token.value === '(' && !open && isWord(tokens[index - 1], 'in')) {
      open = true;
    } else if (token.value === ')' && open) {
      open = false;
    } else if (token.value !== ',' || !open) {
      // Any other parenthesis (a function call, grouping, nesting) or a comma outside a list.
      return false;
    }
  }
  return !open;
}

/**
 * Reads the right-hand side of a space clause starting after the `space` word.
 * @param {CqlToken[]} tokens - The filter tokens.
 * @param {number} at - Index of the token after `space`.
 * @returns {string[] | undefined} The space keys named, or undefined when the clause is not
 *   `= KEY` or `in (KEY, ...)`.
 */
function readSpaceValues(tokens, at) {
  const first = tokens[at];
  if (first?.type === 'op' && first.value === '=') {
    return isValue(tokens[at + 1]) ? [tokens[at + 1].value] : undefined;
  }
  if (!isWord(first, 'in') || tokens[at + 1]?.value !== '(') {
    return undefined;
  }
  const values = [];
  let index = at + 2;
  while (isValue(tokens[index])) {
    values.push(tokens[index].value);
    index += 1;
    if (tokens[index]?.value !== ',') {
      break;
    }
    index += 1;
  }
  return tokens[index]?.value === ')' && values.length > 0 ? values : undefined;
}

/**
 * Collects the space keys of every clause on the `space` field. A field name can only stand at the
 * start of the expression or right after `and`, which keeps the word `space` as a value harmless.
 * @param {CqlToken[]} tokens - The filter tokens.
 * @returns {string[] | undefined} The keys, or undefined when some `space` clause is not understood.
 */
function readSpaceClauses(tokens) {
  const keys = [];
  for (const [index, token] of tokens.entries()) {
    const isField = index === 0 || isWord(tokens[index - 1], 'and');
    if (!isField || !isWord(token, 'space')) {
      continue;
    }
    const values = readSpaceValues(tokens, index + 1);
    if (values === undefined) {
      return undefined;
    }
    keys.push(...values);
  }
  return keys;
}

/**
 * Checks a Confluence CQL search. The expression may only AND clauses together (no OR, NOT,
 * functions or nesting), so one `space` clause confines the whole search; every space it names
 * must be allowed.
 * @param {unknown} args - Tool arguments.
 * @param {Scope} scope - What may be touched.
 * @returns {ScopeResult} Whether the search is confined to allowed spaces.
 */
export function checkCql(args, scope) {
  const { cql, [ARGUMENTS.cqlContext]: context } = asRecord(args);
  if (context !== undefined && context !== null && context !== '') {
    return deny('cql-context', 'Do not pass cqlcontext; put the space in the cql itself.');
  }
  const tokens = isFilled(cql) ? tokenizeCql(cql) : undefined;
  if (tokens === undefined) {
    return deny(
      'cql-unparseable',
      'Provide a CQL expression such as: space = KEY AND text ~ "term".',
    );
  }
  const { filter, valid } = splitOrderBy(tokens);
  if (!valid) {
    return deny('cql-order-by', 'Only field names may follow order by.');
  }
  if (
    filter.some(
      (token) => token.type === 'word' && CQL_FORBIDDEN_WORDS.has(token.value.toLowerCase()),
    )
  ) {
    return deny('cql-boolean', 'CQL may not use OR or NOT; join clauses with AND.');
  }
  if (!hasOnlyListParentheses(filter)) {
    return deny('cql-parens', 'CQL may only use parentheses in an in (...) list.');
  }
  const keys = readSpaceClauses(filter);
  if (keys === undefined || keys.length === 0) {
    return deny('cql-space', 'Restrict the search with space = KEY or space in (KEY, ...).');
  }
  const stray = keys.find((key) => !scope.spaceKeys.has(key.toLowerCase()));
  return stray === undefined
    ? OK
    : deny('cql-space-not-allowed', `Space ${stray} is not in the allowed list.`);
}
