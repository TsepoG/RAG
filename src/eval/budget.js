// @ts-check
import { EvalError } from '../errors/index.js';

/** The depth of the most plain-spoken roles, whose answers are the ones most often rewritten. */
const PLAIN_DEPTH = 1;

/** A question, then a request for the report, then a rewrite. */
const MAX_REQUESTS_PER_CASE = 3;

/** The tag of a case written to tempt the assistant into code or file paths. */
const STYLE_TRAP_TAG = 'style-trap';

/**
 * What a run is expected to cost in Copilot requests. One question is one request, and an answer
 * that does not suit its role is rewritten with a second one, and one whose confidence report is
 * missing is asked for it again with another.
 * @typedef {object} Estimate
 * @property {number} cases - How many cases will run.
 * @property {number} expected - Requests if only the cases likely to be rewritten, or to lack a
 *   report, are.
 * @property {number} worstCase - Requests if every case is rewritten and has its report asked for again.
 */

/**
 * Estimates the requests a run will use, so the owner can decide before it starts.
 * @param {ReadonlyArray<import('./schema.js').EvalCase>} cases - The cases that will run.
 * @param {ReadonlyMap<string, { depth: number }>} roles - The roles, to know which are plain-spoken.
 * @returns {Estimate} The estimate.
 */
export function estimateRequests(cases, roles) {
  const likelyRewrites = cases.filter(
    ({ role, tags, expect: expected }) =>
      expected.status === 'answered' &&
      (roles.get(role)?.depth === PLAIN_DEPTH || tags.includes(STYLE_TRAP_TAG)),
  ).length;
  // Every miss of the report so far was on a reply that declines or asks a question.
  const likelyRepairs = cases.filter(
    ({ expect: expected }) => expected.status !== 'answered',
  ).length;
  return {
    cases: cases.length,
    expected: cases.length + likelyRewrites + likelyRepairs,
    worstCase: cases.length * MAX_REQUESTS_PER_CASE,
  };
}

/**
 * What happened to one question, as far as requests go.
 * @typedef {object} RequestOutcome
 * @property {boolean} [rewritten] - Whether the answer was rewritten.
 * @property {boolean} [rewriteRejected] - Whether a rewrite was tried and not used.
 * @property {boolean} [metaRepaired] - Whether the confidence report was asked for again and got.
 */

/**
 * Counts the requests a run uses and says when to stop.
 * @typedef {object} RequestGuard
 * @property {() => boolean} canStart - Whether another case may start. False once the limit is
 *   reached, and from then on.
 * @property {(outcome: RequestOutcome) => void} record - Adds what a finished case used.
 * @property {() => { limit: number | undefined, used: number, casesRun: number, stoppedEarly: boolean }} report
 *   What the run used, how many cases ran, and whether the limit stopped it.
 */

/**
 * Creates the guard for a run. It stops before starting a case once the limit is reached. A case
 * that has started always finishes, so the last one can go one request over when it is rewritten.
 * @param {number | undefined} limit - The most requests to use, or undefined for no limit.
 * @returns {RequestGuard} The guard.
 * @throws {EvalError} When the limit is not a whole number of at least 1.
 */
export function createRequestGuard(limit) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new EvalError(`The request limit must be a whole number of at least 1, not ${limit}.`);
  }
  let used = 0;
  let casesRun = 0;
  let stoppedEarly = false;
  return {
    canStart() {
      if (limit !== undefined && used >= limit) {
        stoppedEarly = true;
      }
      return !stoppedEarly;
    },
    record({ rewritten = false, rewriteRejected = false, metaRepaired = false }) {
      used += 1 + (rewritten || rewriteRejected ? 1 : 0) + (metaRepaired ? 1 : 0);
      casesRun += 1;
    },
    report() {
      return { limit, used, casesRun, stoppedEarly };
    },
  };
}
