// @ts-check
import { ERROR_STATUS } from './score.js';

/** The share of runs at or below the median. */
const MEDIAN = 0.5;

/** The share of runs at or below the 95th percentile. */
const P95 = 0.95;

/**
 * A count out of a total, with its share. The share is undefined when the total is zero, so a
 * report can say "not applicable" and not "0%".
 * @typedef {object} Ratio
 * @property {number} count - How many.
 * @property {number} of - Out of how many.
 * @property {number | undefined} rate - `count / of`, or undefined when `of` is zero.
 */

/**
 * What a set of scores adds up to.
 * @typedef {object} Summary
 * @property {number} cases - How many cases were scored.
 * @property {number} errors - How many failed before an answer.
 * @property {Ratio} passed - Cases where every check that applies passed.
 * @property {Ratio} statusAccuracy - Cases with exactly the expected status.
 * @property {Ratio} declinedAppropriately - Of the cases that expect not_found or out_of_scope, those
 *   that got either.
 * @property {Ratio} honest - Of the same cases, those that did not claim more than low confidence.
 * @property {number | undefined} citationRecall - The mean share of expected sources cited, over
 *   the cases that expect any.
 * @property {number} citationCases - How many cases expect sources.
 * @property {Ratio} mustNotCiteViolations - Cases that cited a forbidden source.
 * @property {Ratio} maxConfidenceRespected - Of the cases with a highest confidence, those that kept to it.
 * @property {Ratio} plainStyleViolations - Cases for the most plain-spoken roles with style
 *   problems left after the rewrite.
 * @property {Ratio} metaErrors - Cases where the assistant did not report its confidence, even when asked again.
 * @property {Ratio} metaRepaired - Cases where the first reply had no usable report and a second request got one.
 * @property {Ratio} metaRepairRejected - Cases where a second request was sent and got no report.
 * @property {Ratio} invalidKeys - Cases with a citation key that was never given out.
 * @property {Ratio} uncitedSentences - Cases with a sentence that makes a claim without a citation.
 * @property {number | undefined} inferredShare - The mean share of cited sources that are the assistant's reading.
 * @property {Ratio} rewritten - Cases whose answer was rewritten.
 * @property {Ratio} rewriteRejected - Cases where a rewrite was tried and not used.
 * @property {number} callBudgetHits - Cases that used all their tool calls.
 * @property {{ p50: number | undefined, p95: number | undefined }} latencyMs - Time to an answer.
 * @property {{ high: number, medium: number, low: number, none: number }} confidence - How many answers
 *   claimed each level; `none` is every case that claimed no level.
 * @property {Record<string, Record<string, number>>} confusion - For each expected status, how many
 *   cases got each actual status.
 * @property {Record<string, string[]>} failures - The ids of the cases behind each failed check.
 */

/**
 * Builds a ratio.
 * @param {number} count - How many.
 * @param {number} of - Out of how many.
 * @returns {Ratio} The ratio.
 */
function ratio(count, of) {
  return { count, of, rate: of === 0 ? undefined : count / of };
}

/**
 * The mean of some numbers.
 * @param {ReadonlyArray<number>} values - The numbers.
 * @returns {number | undefined} Their mean, or undefined when there are none.
 */
function mean(values) {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * A percentile by the nearest-rank method, which always returns a value that was seen.
 * @param {ReadonlyArray<number>} values - The numbers.
 * @param {number} share - The share of values at or below the result, from 0 to 1.
 * @returns {number | undefined} The value, or undefined when there are none.
 */
export function percentile(values, share) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(Math.ceil(share * sorted.length) - 1, 0)];
}

/**
 * Counts the cases that satisfy a test, out of those it applies to.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} scores - The scores.
 * @param {(score: import('./score.js').CaseScore) => boolean | undefined} test - True or false when
 *   it applies to the case, undefined when it does not.
 * @returns {Ratio} How many were true, out of those it applies to.
 */
function countWhere(scores, test) {
  const applicable = scores.map(test).filter((value) => value !== undefined);
  return ratio(applicable.filter(Boolean).length, applicable.length);
}

/**
 * Counts each expected status against each actual one.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} scores - The scores.
 * @returns {Record<string, Record<string, number>>} The matrix.
 */
function confusionMatrix(scores) {
  /** @type {Record<string, Record<string, number>>} */
  const matrix = {};
  for (const { expectedStatus, status } of scores) {
    matrix[expectedStatus] ??= {};
    matrix[expectedStatus][status] = (matrix[expectedStatus][status] ?? 0) + 1;
  }
  return matrix;
}

/**
 * The ids of the cases that fail each check, which is where to look for what to improve.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} scores - The scores.
 * @returns {Record<string, string[]>} Check name to case ids, in case order; only checks that failed.
 */
function failedCases(scores) {
  /** @type {Record<string, (one: import('./score.js').CaseScore) => boolean>} */
  const checks = {
    wrongStatus: (one) => !one.statusMatch,
    dishonest: (one) => one.honest === false,
    notDeclined: (one) => one.declinedAppropriately === false,
    missedSources: (one) => one.missedSources > 0,
    forbiddenSource: (one) => one.mustNotCiteHits > 0,
    tooConfident: (one) => one.maxConfidenceRespected === false,
    plainStyle: (one) => one.plainStyleViolations > 0,
    metaError: (one) => one.metaError,
    invalidKeys: (one) => one.invalidKeys > 0,
    uncitedSentences: (one) => one.uncitedSentences > 0,
    error: (one) => one.status === ERROR_STATUS,
  };
  return Object.fromEntries(
    Object.entries(checks)
      .map(([name, failed]) => [name, scores.filter((one) => failed(one)).map(({ id }) => id)])
      .filter(([, ids]) => ids.length > 0),
  );
}

/**
 * Adds up the scores of a run. Pure; an empty run gives zero counts and undefined shares.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} scores - One score per case.
 * @returns {Summary} The totals.
 */
export function summarise(scores) {
  const total = scores.length;
  const recalls = scores.flatMap(({ citationRecall }) =>
    citationRecall === undefined ? [] : [citationRecall],
  );
  const shares = scores.flatMap(({ inferredShare }) =>
    inferredShare === undefined ? [] : [inferredShare],
  );
  const latencies = scores.map(({ latencyMs }) => latencyMs);
  return {
    cases: total,
    errors: scores.filter(({ status }) => status === ERROR_STATUS).length,
    passed: countWhere(scores, ({ passed }) => passed),
    statusAccuracy: countWhere(scores, ({ statusMatch }) => statusMatch),
    declinedAppropriately: countWhere(scores, ({ declinedAppropriately }) => declinedAppropriately),
    honest: countWhere(scores, ({ honest }) => honest),
    citationRecall: mean(recalls),
    citationCases: recalls.length,
    mustNotCiteViolations: countWhere(scores, ({ mustNotCiteHits }) => mustNotCiteHits > 0),
    maxConfidenceRespected: countWhere(
      scores,
      ({ maxConfidenceRespected }) => maxConfidenceRespected,
    ),
    plainStyleViolations: ratio(
      scores.filter(({ plainStyleViolations }) => plainStyleViolations > 0).length,
      total,
    ),
    metaErrors: countWhere(scores, ({ metaError }) => metaError),
    metaRepaired: countWhere(scores, ({ metaRepaired }) => metaRepaired),
    metaRepairRejected: countWhere(scores, ({ metaRepairRejected }) => metaRepairRejected),
    invalidKeys: countWhere(scores, ({ invalidKeys }) => invalidKeys > 0),
    uncitedSentences: countWhere(scores, ({ uncitedSentences }) => uncitedSentences > 0),
    inferredShare: mean(shares),
    rewritten: countWhere(scores, ({ rewritten }) => rewritten),
    rewriteRejected: countWhere(scores, ({ rewriteRejected }) => rewriteRejected),
    callBudgetHits: scores.filter(({ callBudgetHit }) => callBudgetHit).length,
    latencyMs: { p50: percentile(latencies, MEDIAN), p95: percentile(latencies, P95) },
    confidence: {
      high: scores.filter(({ confidence }) => confidence === 'high').length,
      medium: scores.filter(({ confidence }) => confidence === 'medium').length,
      low: scores.filter(({ confidence }) => confidence === 'low').length,
      none: scores.filter(({ confidence }) => confidence === null).length,
    },
    confusion: confusionMatrix(scores),
    failures: failedCases(scores),
  };
}
