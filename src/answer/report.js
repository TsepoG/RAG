// @ts-check
import { renderFinalAnswer, SECTION_TITLES } from '../honesty/index.js';

/**
 * The parts of the result and role the report needs.
 * @typedef {object} ReportInput
 * @property {import('./askQuestion.js').AskResult} result - The outcome of the question.
 * @property {{ displayName: string, depth: number } & import('../honesty/index.js').RenderRole} role - The role
 *   the answer was written for.
 */

const MS_PER_SECOND = 1000;
const SHORT_SHA_LENGTH = 7;
/** Roles at or below this depth see business labels instead of file paths. */
const LABEL_DEPTH = 1;
const STALE_NOTE = 'may be out of date';
const INDENT = '  ';
const INTERPRETATION_NOTE = 'my reading of it';

/**
 * Describes where a GitHub source is pinned.
 * @param {import('./result.js').CitedSource & { type: 'github' }} source - The source.
 * @returns {string[]} Notes for the parentheses after the link.
 */
function githubNotes(source) {
  if (source.kind === 'directory' || source.kind === 'releases') {
    return [
      source.kind === 'releases' ? 'release list' : 'folder listing',
      ...(source.pinned ? [`commit ${source.commitSha.slice(0, SHORT_SHA_LENGTH)}`] : []),
    ];
  }
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
  const all = source.inferred ? [...notes, INTERPRETATION_NOTE] : notes;
  const note = all.length === 0 ? '' : ` (${all.join(', ')})`;
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
 * Writes a page or file that was looked at, for the "also consulted" and "closest pages" lists.
 * @param {{ key?: string, title: string, url: string }} item - The item.
 * @returns {string} The line.
 */
function formatConsulted({ key, title, url }) {
  const prefix = key === undefined ? '' : `[${key}] `;
  return `${INDENT}- ${prefix}${title} — ${url}`;
}

/**
 * Writes a titled list, or nothing when the list is empty.
 * @param {string} title - The heading.
 * @param {ReadonlyArray<string>} lines - The lines under it.
 * @returns {string[]} The block, or an empty block.
 */
function section(title, lines) {
  return lines.length === 0 ? [] : [title, ...lines];
}

/**
 * Writes the first lines: the banner with the level in brackets, and why for an answer that is
 * not fully confirmed.
 * @param {import('../honesty/index.js').RenderedAnswer} rendered - The parts to show.
 * @param {string} reason - The confidence reason.
 * @returns {string[]} The lines.
 */
function formatBanner({ level, banner }, reason) {
  if (banner === '') {
    return [];
  }
  const label = level === null ? '' : `[${level}] `;
  const why = level === 'medium' || level === 'low' ? [`Why: ${reason}`] : [];
  return [`${label}${banner}`, ...why];
}

/**
 * Builds the text `ask` prints. It starts with the banner and level, then the answer, where the
 * documentation and code disagree and what could not be confirmed, then the numbered sources with
 * links the application built, what was only consulted, who might know and the tools used. A
 * clarifying question is printed alone. Developers and other technical roles see each source's
 * title (a file path for code); the most business-facing roles see a plain label instead.
 * @param {ReportInput} input - The result and the role.
 * @returns {string} The report, ending with a newline.
 */
export function formatReport({ result, role }) {
  const friendly = role.depth <= LABEL_DEPTH;
  const rendered = renderFinalAnswer(result, role);
  const answered = result.status === 'answered';
  const seconds = (result.durationMs / MS_PER_SECOND).toFixed(1);
  const sources =
    result.sources.length === 0
      ? [`${INDENT}(none)`]
      : result.sources.map((source) => formatSource(source, friendly));
  const tools =
    result.toolCalls.length === 0 ? [`${INDENT}(none)`] : result.toolCalls.map(formatToolCall);
  const consulted = (answered ? result.alsoConsulted : []).map(formatConsulted);
  const gaps = rendered.gaps.map((gap) => `${INDENT}- ${gap}`);
  const people = rendered.whoToAsk.map(({ name }) => `${INDENT}- ${name}`);
  const closest = rendered.closestPages.map(formatConsulted);
  const asked = result.status === 'clarify';
  const blocks = [
    formatBanner(rendered, result.confidenceReason),
    rendered.text === '' ? [] : [rendered.text],
    rendered.conflicts,
    section(SECTION_TITLES.gaps, gaps),
    answered ? ['Sources', ...sources] : [],
    section('Also consulted', consulted),
    section(SECTION_TITLES.closestPages, closest),
    section(SECTION_TITLES.whoToAsk, people),
    asked ? [] : ['Tools used:', ...tools],
    [`Role: ${role.displayName} | Model: ${result.model ?? 'unknown'} | ${seconds}s`],
  ];
  const text = blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n');
  return `${text}\n`;
}

/**
 * Says what happened about the style of the answer, for the lines printed on stderr.
 * @param {import('./askQuestion.js').AskResult} result - The result.
 * @param {{ displayName: string }} role - The role.
 * @returns {string[]} Zero or more one-line notes.
 */
export function describeStyle(result, role) {
  const notes = [];
  if (result.metaRepaired) {
    notes.push('The confidence report was missing, so it was asked for again.');
  }
  if (result.rewritten) {
    notes.push(`Rewrote the answer to suit a ${role.displayName}.`);
  }
  if (result.rewriteRejected) {
    notes.push(
      `Kept the first answer: the rewrite was not used (${result.rewriteRejectedReason}).`,
    );
  }
  if (result.styleViolations.length > 0) {
    notes.push(
      `The answer still does not suit a ${role.displayName}: ${result.styleViolations.join('; ')}.`,
    );
  }
  return notes;
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
