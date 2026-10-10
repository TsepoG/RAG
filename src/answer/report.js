// @ts-check

/**
 * The parts of the result and role the report needs.
 * @typedef {object} ReportInput
 * @property {import('./askQuestion.js').AskResult} result - The outcome of the question.
 * @property {{ displayName: string, depth: number }} role - The role the answer was written for.
 */

const MS_PER_SECOND = 1000;
const SHORT_SHA_LENGTH = 7;
/** Roles at or below this depth see business labels instead of file paths. */
const LABEL_DEPTH = 1;
const STALE_NOTE = 'may be out of date';
const INDENT = '  ';

/**
 * Describes where a GitHub source is pinned.
 * @param {import('./result.js').CitedSource & { type: 'github' }} source - The source.
 * @returns {string[]} Notes for the parentheses after the link.
 */
function githubNotes(source) {
  if (source.kind === 'release') {
    return [`release ${source.title}`];
  }
  if (source.pinned) {
    return [`commit ${source.commitSha.slice(0, SHORT_SHA_LENGTH)}`];
  }
  return ['latest on the default branch, not pinned to a commit'];
}

/**
 * Formats one cited source: its key, name, link and a note on its version or commit.
 * @param {import('./result.js').CitedSource} source - The source.
 * @param {boolean} friendly - Whether to show the business label instead of the title.
 * @returns {string} The line.
 */
function formatSource(source, friendly) {
  const name = friendly ? source.friendlyLabel : source.title;
  // The label already names the version, so it is not repeated.
  const notes =
    source.type === 'confluence'
      ? [...(friendly ? [] : [`v${source.version}`]), ...(source.stale ? [STALE_NOTE] : [])]
      : githubNotes(source);
  const note = notes.length === 0 ? '' : ` (${notes.join(', ')})`;
  return `${INDENT}[${source.key}] ${name} — ${source.url}${note}`;
}

/**
 * Formats one tool call as a line of the "Tools used" list.
 * @param {import('./toolCalls.js').ToolCallRecord} call - The call.
 * @returns {string} The line.
 */
function formatToolCall({ server, tool, summary, durationMs, success }) {
  const took = durationMs === undefined ? 'no result' : `${durationMs} ms`;
  const failed = success === false ? ', failed' : '';
  const args = summary === '' ? '' : ` (${summary})`;
  return `${INDENT}- ${server} / ${tool}${args} [${took}${failed}]`;
}

/**
 * Builds the text `ask` prints: the answer, the numbered sources with links the application
 * built, what was only consulted, the tools used, and who and how long it took. Developers and
 * other technical roles see each source's title (a file path for code); the most business-facing
 * roles see a plain label instead.
 * @param {ReportInput} input - The result and the role.
 * @returns {string} The report, ending with a newline.
 */
export function formatReport({ result, role }) {
  const friendly = role.depth <= LABEL_DEPTH;
  const sources =
    result.sources.length === 0
      ? [`${INDENT}(none)`]
      : result.sources.map((source) => formatSource(source, friendly));
  const consulted = result.alsoConsulted.map(({ key, title, url }) => {
    const prefix = key === undefined ? '' : `[${key}] `;
    return `${INDENT}- ${prefix}${title} — ${url}`;
  });
  const tools =
    result.toolCalls.length === 0 ? [`${INDENT}(none)`] : result.toolCalls.map(formatToolCall);
  const seconds = (result.durationMs / MS_PER_SECOND).toFixed(1);
  return [
    result.answer.trimEnd(),
    '',
    'Sources',
    ...sources,
    ...(consulted.length === 0 ? [] : ['', 'Also consulted', ...consulted]),
    '',
    'Tools used:',
    ...tools,
    '',
    `Role: ${role.displayName} | Model: ${result.model ?? 'unknown'} | ${seconds}s`,
    '',
  ].join('\n');
}

/**
 * Words the keys the model invented, which were removed from the answer.
 * @param {ReadonlyArray<string>} invalidKeys - The keys.
 * @returns {string | undefined} A one-line note, or undefined when there were none.
 */
export function describeInvalidKeys(invalidKeys) {
  return invalidKeys.length === 0
    ? undefined
    : `Removed citation keys that matched no fetched source: ${invalidKeys.join(', ')}`;
}
