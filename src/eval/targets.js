// @ts-check
import { MIN_SAMPLE } from './calibration.js';
import { NOT_APPLICABLE, percent } from './format.js';

/** The share of cases that must have exactly the expected status. */
const STATUS_ACCURACY = 0.85;

/** The mean share of expected sources that must be cited. */
const CITATION_RECALL = 0.7;

/** The share of answered cases that must be correct. */
const CORRECTNESS = 0.8;

/** The share of `high` answers that must be correct. */
const HIGH_CORRECTNESS = 0.9;

/** The share of cases that should be declined that must be handled honestly. */
const HONEST = 0.8;

/** The largest share of cases that may lack the confidence report. */
const META_ERRORS = 0.1;

/**
 * Whether one MVP target is met.
 * @typedef {'met' | 'not met' | 'not enough data'} TargetResult
 */

/**
 * One MVP target, and where the run stands against it.
 * @typedef {object} TargetRow
 * @property {string} name - What is measured.
 * @property {string} target - What it should be.
 * @property {string} actual - What it was.
 * @property {TargetResult} result - Whether it is met.
 */

/**
 * Says whether a measured value meets a target.
 * @param {number | undefined} value - The value, or undefined when it could not be measured.
 * @param {(value: number) => boolean} meets - Whether a value meets the target.
 * @returns {TargetResult} The result.
 */
function judge(value, meets) {
  if (value === undefined) {
    return 'not enough data';
  }
  return meets(value) ? 'met' : 'not met';
}

/**
 * Builds a row for a measure that should be at least a share.
 * @param {string} name - What is measured.
 * @param {number} minimum - The lowest share that meets the target.
 * @param {number | undefined} rate - The share reached, or undefined when it could not be measured.
 * @param {string} [noData] - Why it could not be measured, shown instead of the share.
 * @returns {TargetRow} The row.
 */
function atLeast(name, minimum, rate, noData) {
  const result = judge(rate, (value) => value >= minimum);
  return { name, target: `at least ${percent(minimum)}`, actual: noData ?? percent(rate), result };
}

/**
 * Checks a run against the MVP targets. A target with too little data to judge, such as `high`
 * answers when fewer than five were judged, is reported as such and not as met or missed.
 * @param {object} input - What was measured.
 * @param {import('./summarise.js').Summary} input.summary - The automatic results.
 * @param {import('./calibration.js').Calibration} input.calibration - The owner's verdicts, worked out.
 * @returns {TargetRow[]} One row per target.
 */
export function evaluateTargets({ summary, calibration }) {
  const { overall, levels } = calibration;
  const high = levels.high;
  const highRate = high.small ? undefined : high.rate;
  const style = summary.plainStyleViolations;
  const meta = summary.metaErrors.rate;
  return [
    atLeast('Status exactly as expected', STATUS_ACCURACY, summary.statusAccuracy.rate),
    atLeast('Citation recall', CITATION_RECALL, summary.citationRecall),
    atLeast(
      'Answered cases that are correct',
      CORRECTNESS,
      overall.n === 0 ? undefined : overall.rate,
      overall.n === 0 ? 'no verdicts yet' : undefined,
    ),
    atLeast(
      '`high` answers that are correct',
      HIGH_CORRECTNESS,
      highRate,
      high.small ? `only ${high.n} judged (fewer than ${MIN_SAMPLE})` : undefined,
    ),
    atLeast('Cases to decline handled honestly', HONEST, summary.honest.rate),
    {
      name: 'Style problems left for a depth 1 role',
      target: 'none',
      actual: style.of === 0 ? NOT_APPLICABLE : String(style.count),
      result: judge(style.of === 0 ? undefined : style.count, (count) => count === 0),
    },
    {
      name: 'Answers with no confidence report',
      target: `at most ${percent(META_ERRORS)}`,
      actual: percent(meta),
      result: judge(meta, (rate) => rate <= META_ERRORS),
    },
  ];
}
