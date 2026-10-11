// @ts-check

/** The confidence levels, from most to least sure. */
export const LEVELS = Object.freeze(/** @type {const} */ (['high', 'medium', 'low']));

/** Fewest judged answers at a level before anything is concluded from them. */
export const MIN_SAMPLE = 5;

/** How much a partly correct answer counts for. */
const PARTIAL_VALUE = 0.5;

/**
 * How the judged answers at one level (or all of them) came out.
 * @typedef {object} Tally
 * @property {number} n - How many answers were judged.
 * @property {number} correct - How many were correct.
 * @property {number} partial - How many were partly correct.
 * @property {number} wrong - How many were wrong.
 * @property {number | undefined} rate - The share correct, counting a partly correct answer as
 *   half; undefined when none were judged.
 * @property {boolean} small - True when there are fewer than {@link MIN_SAMPLE} answers, too few
 *   to conclude anything.
 */

/**
 * How well the confidence the assistant claimed matches how right it was.
 * @typedef {object} Calibration
 * @property {number} answered - How many cases the assistant answered.
 * @property {number} judged - How many of them the owner has judged.
 * @property {string[]} unjudged - Ids of answered cases with no verdict yet.
 * @property {Tally} overall - All the judged answers.
 * @property {Record<typeof LEVELS[number], Tally>} levels - The judged answers at each confidence level.
 */

/**
 * Counts verdicts.
 * @param {ReadonlyArray<string>} verdicts - Each is `correct`, `partial` or `wrong`.
 * @returns {Tally} The tally.
 */
function tally(verdicts) {
  const count = (/** @type {string} */ verdict) => verdicts.filter((one) => one === verdict).length;
  const correct = count('correct');
  const partial = count('partial');
  const n = verdicts.length;
  return {
    n,
    correct,
    partial,
    wrong: count('wrong'),
    rate: n === 0 ? undefined : (correct + partial * PARTIAL_VALUE) / n,
    small: n < MIN_SAMPLE,
  };
}

/**
 * Works out correctness, and correctness at each confidence level, from the owner's verdicts. Only
 * cases the assistant answered count: a case it declined has nothing to be right or wrong about.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} scores - One score per case.
 * @param {ReadonlyMap<string, { verdict: string }>} judgements - The owner's verdicts, by case id.
 * @returns {Calibration} The calibration.
 */
export function buildCalibration(scores, judgements) {
  const answered = scores.filter(({ status }) => status === 'answered');
  const judged = answered.flatMap(({ id, confidence }) => {
    const judgement = judgements.get(id);
    return judgement === undefined ? [] : [{ confidence, verdict: judgement.verdict }];
  });
  const verdictsAt = (/** @type {typeof LEVELS[number] | undefined} */ level) =>
    judged
      .filter(({ confidence }) => level === undefined || confidence === level)
      .map(({ verdict }) => verdict);
  return {
    answered: answered.length,
    judged: judged.length,
    unjudged: answered.filter(({ id }) => !judgements.has(id)).map(({ id }) => id),
    overall: tally(verdictsAt(undefined)),
    levels: {
      high: tally(verdictsAt('high')),
      medium: tally(verdictsAt('medium')),
      low: tally(verdictsAt('low')),
    },
  };
}
