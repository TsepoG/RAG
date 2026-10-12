// @ts-check
import { percent, ratioText, seconds, table } from './format.js';
import { formatModelSwitches } from './switches.js';

/** A line break, and a blank line between paragraphs. */
const LINE = '\n';
const PARAGRAPH = '\n\n';

/** The statuses, in the order a reader expects them. */
const STATUS_ORDER = ['answered', 'not_found', 'clarify', 'out_of_scope', 'error'];

/**
 * Writes how many requests a run used.
 * @param {import('./results.js').RunHeader['requests']} requests - What the run used.
 * @returns {string} For example `14 for 8 cases (limit 20)`.
 */
function requestsText({ used, casesRun, limit }) {
  const limitText = limit === undefined ? '' : ` (limit ${limit})`;
  return `${used} for ${casesRun} cases${limitText}`;
}

/**
 * Writes what a run was tied to, so two summaries can be compared.
 * @param {import('./results.js').RunHeader} run - The run.
 * @returns {string} A markdown table.
 */
export function formatRunInfo(run) {
  const versions = Object.entries(run.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, version]) => `${id} v${version}`)
    .join(', ');
  return table(
    ['Run', ''],
    [
      ['Started', run.startedAt],
      ['Commit', `${run.commit}${run.dirty ? ' (uncommitted changes)' : ''}`],
      ['Model asked for', run.model],
      ['Models that answered', run.models.length === 0 ? 'none recorded' : run.models.join(', ')],
      ['Role versions', versions],
      ['Base prompt hash', run.basePromptHash],
      ['Requests used', requestsText(run.requests)],
    ],
  );
}

/**
 * Writes the expected-against-actual status matrix.
 * @param {Record<string, Record<string, number>>} confusion - The matrix from `summarise`.
 * @returns {string} A markdown table with a row per expected status.
 */
export function formatConfusion(confusion) {
  const actual = STATUS_ORDER.filter((status) =>
    Object.values(confusion).some((row) => row[status] !== undefined),
  );
  const rows = STATUS_ORDER.filter((status) => confusion[status] !== undefined).map((expected) => [
    expected,
    ...actual.map((status) => String(confusion[expected][status] ?? 0)),
  ]);
  return table(['Expected / got', ...actual], rows);
}

/**
 * Writes the ids behind each failed check.
 * @param {Record<string, string[]>} failures - From `summarise`.
 * @returns {string} A list, or a line saying nothing failed.
 */
export function formatFailures(failures) {
  const entries = Object.entries(failures);
  return entries.length === 0
    ? 'No check failed.'
    : entries.map(([check, ids]) => `- **${check}** (${ids.length}): ${ids.join(', ')}`).join('\n');
}

/**
 * Writes every automatic measure as a table.
 * @param {import('./summarise.js').Summary} summary - What the scores add up to.
 * @returns {string} A markdown table.
 */
export function formatMetrics(summary) {
  const { latencyMs } = summary;
  return table(
    ['Measure', 'Result'],
    [
      ['Cases that passed every check that applies', ratioText(summary.passed)],
      ['Status exactly as expected', ratioText(summary.statusAccuracy)],
      [
        'Declined when it should (not_found or out_of_scope, either)',
        ratioText(summary.declinedAppropriately),
      ],
      [
        'Honest on cases that should be declined (no answer above low confidence)',
        ratioText(summary.honest),
      ],
      ['Citation recall', `${percent(summary.citationRecall)} over ${summary.citationCases} cases`],
      ['Cited a forbidden source', ratioText(summary.mustNotCiteViolations)],
      ['Kept to the highest confidence allowed', ratioText(summary.maxConfidenceRespected)],
      ['Style problems left for a depth 1 role', ratioText(summary.plainStyleViolations)],
      ['Meta block missing', ratioText(summary.metaErrors)],
      ['Invalid citation keys', ratioText(summary.invalidKeys)],
      ['Sentences without a citation', ratioText(summary.uncitedSentences)],
      ['Cited sources that are the assistant’s own reading', percent(summary.inferredShare)],
      ['Answers rewritten', ratioText(summary.rewritten)],
      ['Rewrites tried and not used', ratioText(summary.rewriteRejected)],
      ['Questions that used every tool call', String(summary.callBudgetHits)],
      ['Questions that failed', String(summary.errors)],
      [
        'Time to an answer (median, 95th percentile)',
        `${seconds(latencyMs.p50)}, ${seconds(latencyMs.p95)}`,
      ],
    ],
  );
}

/**
 * Writes the automatic results of a run as markdown.
 * @param {object} input - What to write.
 * @param {import('./results.js').RunHeader} input.run - The run.
 * @param {import('./summarise.js').Summary} input.summary - What the scores add up to.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} [input.entries] - The cases, for the model
 *   section; left out, the section is left out.
 * @returns {string} The summary, ending with a line break.
 */
export function formatSummary({ run, summary, entries }) {
  const { confidence } = summary;
  const metrics = formatMetrics(summary);
  const sections = [
    '# Eval summary',
    formatRunInfo(run),
    ...(run.interrupted ? ['The run was interrupted; these are the cases that finished.'] : []),
    `## Results (${summary.cases} cases)`,
    metrics,
    [
      '“Status exactly as expected” is strict: a not_found answer to an out_of_scope question is a miss.',
      '“Declined when it should” counts either of the two as right. Both are reported on purpose.',
    ].join(LINE),
    '## Confidence claimed',
    `high ${confidence.high}, medium ${confidence.medium}, low ${confidence.low}, none ${confidence.none}`,
    '## Expected against actual status',
    formatConfusion(summary.confusion),
    '## Failed checks',
    formatFailures(summary.failures),
    ...(entries === undefined ? [] : ['## Models', formatModelSwitches(entries)]),
  ];
  return sections.join(PARAGRAPH) + LINE;
}
