// @ts-check
import { buildCalibration, LEVELS } from './calibration.js';
import { compareRuns } from './compare.js';
import { percent, table } from './format.js';
import { formatConfusion, formatFailures, formatMetrics, formatRunInfo } from './summary.js';
import { summarise } from './summarise.js';
import { evaluateTargets } from './targets.js';

/**
 * Lists how two runs differ in what they were tied to, so a change in results can be traced to a
 * change in the code, the model, a role or the prompt.
 * @param {import('./results.js').RunHeader} before - The first run.
 * @param {import('./results.js').RunHeader} after - The second run.
 * @returns {string[]} One line per difference; none when they are the same.
 */
export function diffRunInfo(before, after) {
  /** @type {string[]} */
  const lines = [];
  const note = (
    /** @type {string} */ what,
    /** @type {unknown} */ from,
    /** @type {unknown} */ to,
  ) => {
    if (from !== to) {
      lines.push(`${what}: ${String(from)} → ${String(to)}`);
    }
  };
  note('commit', before.commit, after.commit);
  note('working tree had uncommitted changes', before.dirty, after.dirty);
  note('model asked for', before.model, after.model);
  note('models that answered', before.models.join(', '), after.models.join(', '));
  note('base prompt hash', before.basePromptHash, after.basePromptHash);
  note('asked as', before.path, after.path);
  const ids = [...new Set([...Object.keys(before.roles), ...Object.keys(after.roles)])].sort(
    (a, b) => a.localeCompare(b),
  );
  for (const id of ids) {
    note(`role ${id} version`, before.roles[id] ?? 'none', after.roles[id] ?? 'none');
  }
  return lines;
}

/**
 * Writes how correct the answers were, and how well the confidence claimed matched.
 * @param {import('./calibration.js').Calibration} calibration - The owner's verdicts, worked out.
 * @returns {string} Markdown.
 */
function formatCalibration(calibration) {
  const { overall, levels, answered, judged, unjudged } = calibration;
  const row = (
    /** @type {string} */ name,
    /** @type {import('./calibration.js').Tally} */ tally,
  ) => [
    name,
    String(tally.n),
    `${tally.correct} / ${tally.partial} / ${tally.wrong}`,
    percent(tally.rate),
    tally.n === 0 || !tally.small ? '' : `small sample (${tally.n}): no conclusion`,
  ];
  const lines = [
    table(
      ['Confidence claimed', 'Judged', 'Correct / partial / wrong', 'Share correct', 'Note'],
      [...LEVELS.map((level) => row(level, levels[level])), row('all answered', overall)],
    ),
    '',
    `${judged} of ${answered} answered cases have a verdict. A partly correct answer counts as half.`,
  ];
  if (unjudged.length > 0) {
    lines.push('', `Still to judge: ${unjudged.join(', ')}.`);
  }
  return lines.join('\n');
}

/**
 * Writes the comparison with an earlier run.
 * @param {import('./compare.js').Comparison} comparison - How the two runs differ.
 * @param {string[]} differences - How what they were tied to differs.
 * @returns {string} Markdown.
 */
function formatComparison(comparison, differences) {
  const tied =
    differences.length === 0
      ? 'Same commit, model, role versions and base prompt.'
      : differences.map((line) => `- ${line}`).join('\n');
  const changes = comparison.changed.map(
    ({ id, before, after }) =>
      `- ${id}: ${before.status}${before.passed ? '' : ' (failed)'} → ${after.status}${after.passed ? '' : ' (failed)'}`,
  );
  return [
    `Cases in both runs: ${comparison.compared}. Passed: ${comparison.passedBefore} → ${comparison.passedAfter}.`,
    `Changed outcome (status, or whether it passed): ${comparison.changed.length}. Confidence changed on ${comparison.confidenceChanged}.`,
    ...(changes.length === 0 ? [] : ['', ...changes]),
    '',
    '**What differs between the runs**',
    '',
    tied,
  ].join('\n');
}

/**
 * Writes the feedback the web page collected.
 * @param {import('./feedback.js').FeedbackSummary} feedback - The counts.
 * @param {number} skipped - Lines of the file that could not be read.
 * @returns {string} Markdown.
 */
function formatFeedback(feedback, skipped) {
  if (feedback.total === 0) {
    return 'No feedback has been given yet.';
  }
  const votes = (/** @type {Record<string, import('./feedback.js').Votes>} */ groups) =>
    table(
      ['', 'Up', 'Down'],
      Object.entries(groups).map(([name, { up, down }]) => [name, String(up), String(down)]),
    );
  const wrong = Object.entries(feedback.wrongSources).map(([key, count]) => `${key} (${count})`);
  const skippedNote = skipped > 0 ? ` ${skipped} lines could not be read and were skipped.` : '';
  return [
    `${feedback.total} pieces of feedback: ${feedback.votes.up} up, ${feedback.votes.down} down (${percent(feedback.upShare)} up). ${feedback.comments} have a comment.${skippedNote}`,
    '',
    '**By role**',
    '',
    votes(feedback.byRole),
    '',
    '**By status of the answer**',
    '',
    votes(feedback.byStatus),
    '',
    `Sources named as wrong: ${wrong.length === 0 ? 'none' : wrong.join(', ')}.`,
  ].join('\n');
}

/**
 * Everything the report is built from.
 * @typedef {object} ReportInput
 * @property {import('./results.js').RunHeader} header - What the run was tied to and what it used.
 * @property {ReadonlyArray<import('./score.js').CaseScore>} scores - One score per case.
 * @property {ReadonlyMap<string, import('./review.js').Judgement>} judgements - The owner's verdicts.
 * @property {{ blank: string[], missing: string[] } | undefined} review - What was found reading the
 *   sheet, or undefined when there is no sheet yet.
 * @property {{ summary: import('./feedback.js').FeedbackSummary, skipped: number } | undefined} feedback
 *   The feedback, or undefined when there is none to read.
 * @property {{ header: import('./results.js').RunHeader, scores: ReadonlyArray<import('./score.js').CaseScore> } | undefined} previous
 *   An earlier run to compare with.
 */

/**
 * Builds the report of a run: what it was tied to, the MVP targets, correctness and calibration
 * from the owner's verdicts, every automatic measure, a comparison with an earlier run if given,
 * and the feedback. Pure, and the same for the same input.
 * @param {ReportInput} input - The run, the verdicts, and the optional comparison and feedback.
 * @returns {string} The report as markdown, ending with a line break.
 */
export function buildReport({ header, scores, judgements, review, feedback, previous }) {
  const summary = summarise(scores);
  const calibration = buildCalibration(scores, judgements);
  const targets = evaluateTargets({ summary, calibration });
  const sheetNote =
    review === undefined
      ? 'There is no review sheet yet, so correctness and calibration are not measured.'
      : [
          review.missing.length > 0
            ? `Cases missing from the sheet: ${review.missing.join(', ')}.`
            : '',
          review.blank.length > 0 ? `Rows with no verdict: ${review.blank.join(', ')}.` : '',
        ]
          .filter((line) => line !== '')
          .join(' ');
  const sections = [
    '# Eval report',
    formatRunInfo(header),
    '## MVP targets',
    table(
      ['Target', 'Should be', 'Was', 'Result'],
      targets.map(({ name, target, actual, result }) => [name, target, actual, result]),
    ),
    'A target with too little data to judge is reported as such. Missing a target is a finding, not a failure; each miss needs an explanation.',
    '## Correctness and calibration',
    formatCalibration(calibration),
    ...(sheetNote === '' ? [] : [sheetNote]),
    '## Declining',
    [
      `Declined when it should (not_found or out_of_scope, either): ${percent(summary.declinedAppropriately.rate)}.`,
      `Exact status as expected, over every case: ${percent(summary.statusAccuracy.rate)}.`,
      'For the cases that should be declined, the first counts either decline as right. The second is exact, over every case: a case that expected out_of_scope and got not_found is right in the first and wrong in the second.',
    ].join('\n\n'),
    '## Automatic results',
    formatMetrics(summary),
    '### Expected against actual status',
    formatConfusion(summary.confusion),
    '### Failed checks',
    formatFailures(summary.failures),
    ...(previous === undefined
      ? []
      : [
          '## Compared with the earlier run',
          formatComparison(
            compareRuns(previous.scores, scores),
            diffRunInfo(previous.header, header),
          ),
        ]),
    '## Feedback from the web page',
    feedback === undefined
      ? 'There is no feedback file.'
      : formatFeedback(feedback.summary, feedback.skipped),
  ];
  return `${sections.join('\n\n')}\n`;
}
