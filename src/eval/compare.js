// @ts-check

/**
 * One case that came out differently in two runs.
 * @typedef {object} Change
 * @property {string} id - The case id.
 * @property {{ status: string, passed: boolean, confidence: string | null }} before - The first run.
 * @property {{ status: string, passed: boolean, confidence: string | null }} after - The second run.
 */

/**
 * How two runs of the same cases differ. Asking the same question twice does not always give the
 * same answer, so this is the noise a change has to beat before it counts as an improvement.
 * @typedef {object} Comparison
 * @property {number} compared - How many cases are in both runs.
 * @property {Change[]} changed - Cases whose status, or whether they passed, differs.
 * @property {number} confidenceChanged - Cases whose claimed confidence differs, whether or not
 *   they are in `changed`.
 * @property {number} passedBefore - Cases that passed in the first run, among those compared.
 * @property {number} passedAfter - Cases that passed in the second run, among those compared.
 * @property {string[]} onlyBefore - Ids that are only in the first run.
 * @property {string[]} onlyAfter - Ids that are only in the second run.
 */

/**
 * Compares the scores of two runs of the same cases.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} before - The first run.
 * @param {ReadonlyArray<import('./score.js').CaseScore>} after - The second run.
 * @returns {Comparison} How they differ.
 */
export function compareRuns(before, after) {
  const later = new Map(after.map((one) => [one.id, one]));
  /** @type {Change[]} */
  const changed = [];
  let compared = 0;
  let confidenceChanged = 0;
  let passedBefore = 0;
  let passedAfter = 0;
  for (const first of before) {
    const second = later.get(first.id);
    if (second === undefined) {
      continue;
    }
    compared += 1;
    passedBefore += first.passed ? 1 : 0;
    passedAfter += second.passed ? 1 : 0;
    confidenceChanged += first.confidence === second.confidence ? 0 : 1;
    if (first.status !== second.status || first.passed !== second.passed) {
      changed.push({
        id: first.id,
        before: { status: first.status, passed: first.passed, confidence: first.confidence },
        after: { status: second.status, passed: second.passed, confidence: second.confidence },
      });
    }
  }
  const earlier = new Set(before.map(({ id }) => id));
  return {
    compared,
    changed,
    confidenceChanged,
    passedBefore,
    passedAfter,
    onlyBefore: before.filter(({ id }) => !later.has(id)).map(({ id }) => id),
    onlyAfter: after.filter(({ id }) => !earlier.has(id)).map(({ id }) => id),
  };
}
