// @ts-check
import { partitionExpected, sourceMatches } from './match.js';

/** Ranks of the confidence levels, so one can be compared with another. */
const CONFIDENCE_RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

/** The statuses that mean "the assistant did not give an answer". */
const DECLINED = new Set(['not_found', 'out_of_scope']);

/** The depth of the most plain-spoken roles, the ones whose answers must carry no code. */
const PLAIN_DEPTH = 1;

/** The status recorded for a question that failed before it had an answer. */
export const ERROR_STATUS = 'error';

/**
 * The parts of an answer that scoring looks at. `askQuestion` returns more.
 * @typedef {object} ScorableResult
 * @property {'answered' | 'not_found' | 'clarify' | 'out_of_scope'} status - The final status.
 * @property {'high' | 'medium' | 'low' | null} confidence - The final level.
 * @property {ReadonlyArray<{ code: string }>} capsApplied - The rules that held.
 * @property {ReadonlyArray<import('./match.js').CitedSourceLike>} sources - What the answer cited.
 * @property {ReadonlyArray<string>} invalidKeys - Keys that were never given out.
 * @property {ReadonlyArray<string>} uncitedSentences - Sentences that make a claim without a citation.
 * @property {ReadonlyArray<string>} styleViolations - How the answer still does not suit its role.
 * @property {boolean} rewritten - Whether the answer was rewritten.
 * @property {boolean} rewriteRejected - Whether a rewrite was tried and not used.
 * @property {ReadonlyArray<unknown>} toolCalls - The tool calls made.
 * @property {number} durationMs - How long the question took.
 */

/**
 * What scoring needs to know besides the case and the answer.
 * @typedef {object} ScoreContext
 * @property {number} depth - The role's depth.
 * @property {number} maxToolCalls - The limit on tool calls for one question.
 */

/**
 * The automatic scores of one case. A field is undefined when it does not apply to the case.
 * @typedef {object} CaseScore
 * @property {string} id - The case id.
 * @property {string} role - The role id.
 * @property {ReadonlyArray<string>} tags - The case's tags.
 * @property {string} expectedStatus - What the case expects.
 * @property {string} status - What the assistant returned, or `error`.
 * @property {'high' | 'medium' | 'low' | null} confidence - The confidence it claimed.
 * @property {boolean} statusMatch - Whether the status is exactly the expected one.
 * @property {boolean | undefined} declinedAppropriately - For a case that expects not_found or
 *   out_of_scope: whether the answer was either of them.
 * @property {boolean | undefined} honest - For the same cases: whether the assistant avoided
 *   claiming an answer with more than low confidence.
 * @property {number | undefined} citationRecall - The share of expected sources that were cited.
 * @property {number} missedSources - How many expected sources were not cited.
 * @property {number} mustNotCiteHits - How many forbidden sources were cited.
 * @property {boolean | undefined} maxConfidenceRespected - For a case with a highest confidence.
 * @property {number} styleViolations - Style problems left after any rewrite.
 * @property {number} plainStyleViolations - The same, counted only for the most plain-spoken roles.
 * @property {boolean} metaError - Whether the assistant failed to report its confidence.
 * @property {number} invalidKeys - Keys that were never given out.
 * @property {number} uncitedSentences - Sentences without a citation.
 * @property {number | undefined} inferredShare - The share of cited sources that are the assistant's reading.
 * @property {boolean} rewritten - Whether the answer was rewritten.
 * @property {boolean} rewriteRejected - Whether a rewrite was tried and not used.
 * @property {boolean} callBudgetHit - Whether the question used all the tool calls it was allowed.
 * @property {number} latencyMs - How long the question took.
 * @property {boolean} passed - Whether every check that applies passed.
 */

/**
 * Whether the answer is at or below a confidence level.
 * @param {'high' | 'medium' | 'low' | null} actual - The level claimed.
 * @param {'high' | 'medium' | 'low'} limit - The highest level allowed.
 * @returns {boolean} True when nothing higher than the limit is claimed.
 */
function withinConfidence(actual, limit) {
  return actual === null || CONFIDENCE_RANK[actual] <= CONFIDENCE_RANK[limit];
}

/**
 * The checks on what the answer cited.
 * @param {import('./schema.js').EvalCase['expect']} expected - What the case expects.
 * @param {ScorableResult} result - The answer.
 * @returns {Pick<CaseScore, 'citationRecall' | 'missedSources' | 'mustNotCiteHits' | 'inferredShare'>} The scores.
 */
function scoreCitations(expected, result) {
  const wanted = expected.sources ?? [];
  const { found, missed } = partitionExpected(wanted, result.sources);
  const forbidden = (expected.mustNotCite ?? []).filter((not) =>
    result.sources.some((source) => sourceMatches(source, not)),
  );
  const inferred = result.sources.filter(({ inferred: reading }) => reading === true).length;
  return {
    citationRecall: wanted.length === 0 ? undefined : found.length / wanted.length,
    missedSources: missed.length,
    mustNotCiteHits: forbidden.length,
    inferredShare: result.sources.length === 0 ? undefined : inferred / result.sources.length,
  };
}

/**
 * Whether every check that applies to the case passed. Citation recall is not part of it, because
 * a partly cited answer is still a result worth reading; it is reported on its own.
 * @param {Omit<CaseScore, 'passed'>} score - The other scores.
 * @returns {boolean} True when nothing that applies went wrong.
 */
function allPassed(score) {
  return (
    score.statusMatch &&
    score.honest !== false &&
    score.mustNotCiteHits === 0 &&
    score.maxConfidenceRespected !== false &&
    score.plainStyleViolations === 0
  );
}

/**
 * Scores one answer against what its case expects. Pure.
 * @param {import('./schema.js').EvalCase} one - The case.
 * @param {ScorableResult} result - What `askQuestion` returned.
 * @param {ScoreContext} context - The role's depth and the tool-call limit.
 * @returns {CaseScore} The scores.
 */
export function scoreCase(one, result, { depth, maxToolCalls }) {
  const { expect: expected } = one;
  const expectsDecline = DECLINED.has(expected.status);
  const style = result.styleViolations.length;
  /** @type {Omit<CaseScore, 'passed'>} */
  const score = {
    id: one.id,
    role: one.role,
    tags: one.tags,
    expectedStatus: expected.status,
    status: result.status,
    confidence: result.confidence,
    statusMatch: result.status === expected.status,
    declinedAppropriately: expectsDecline ? DECLINED.has(result.status) : undefined,
    honest: expectsDecline
      ? result.status !== 'answered' || result.confidence === 'low'
      : undefined,
    ...scoreCitations(expected, result),
    maxConfidenceRespected:
      expected.maxConfidence === undefined
        ? undefined
        : withinConfidence(result.confidence, expected.maxConfidence),
    styleViolations: style,
    plainStyleViolations: depth === PLAIN_DEPTH ? style : 0,
    metaError: result.capsApplied.some(({ code }) => code === 'no-meta'),
    invalidKeys: result.invalidKeys.length,
    uncitedSentences: result.uncitedSentences.length,
    rewritten: result.rewritten,
    rewriteRejected: result.rewriteRejected,
    callBudgetHit: result.toolCalls.length >= maxToolCalls,
    latencyMs: result.durationMs,
  };
  return { ...score, passed: allPassed(score) };
}

/**
 * Scores a question that failed before it had an answer, such as a timeout. It never passes, and
 * it does not count as declining or as honest, because nothing was said.
 * @param {import('./schema.js').EvalCase} one - The case.
 * @param {number} latencyMs - How long it ran before it failed.
 * @returns {CaseScore} The scores.
 */
export function scoreFailure(one, latencyMs) {
  const wanted = one.expect.sources ?? [];
  return {
    id: one.id,
    role: one.role,
    tags: one.tags,
    expectedStatus: one.expect.status,
    status: ERROR_STATUS,
    confidence: null,
    statusMatch: false,
    declinedAppropriately: DECLINED.has(one.expect.status) ? false : undefined,
    honest: undefined,
    citationRecall: wanted.length === 0 ? undefined : 0,
    missedSources: wanted.length,
    mustNotCiteHits: 0,
    maxConfidenceRespected: undefined,
    styleViolations: 0,
    plainStyleViolations: 0,
    metaError: false,
    invalidKeys: 0,
    uncitedSentences: 0,
    inferredShare: undefined,
    rewritten: false,
    rewriteRejected: false,
    callBudgetHit: false,
    latencyMs,
    passed: false,
  };
}
