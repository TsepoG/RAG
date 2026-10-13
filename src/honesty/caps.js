// @ts-check

/** @typedef {'high' | 'medium' | 'low'} Confidence */
/** @typedef {'answered' | 'not_found' | 'clarify' | 'out_of_scope'} AnswerStatus */

/**
 * A rule that held, and the reason a reader is told.
 * @typedef {object} AppliedCap
 * @property {string} code - Short name of the rule, for logs and `--json`.
 * @property {string} reason - A sentence for the reader.
 */

/**
 * What the application decided about status and confidence.
 * @typedef {object} CapsResult
 * @property {AnswerStatus} status - The final status. `answered` becomes `not_found` when nothing
 *   in the answer could be checked.
 * @property {Confidence | null} confidence - The final level; null unless the status is `answered`.
 * @property {string} confidenceReason - The model's reason followed by the reason of each rule.
 * @property {AppliedCap[]} capsApplied - The rules that held, in the order they are checked.
 */

/**
 * What the rules look at. The model's own report is the starting point; everything else is what the
 * application found out itself.
 * @typedef {object} CapsInput
 * @property {import('./meta.js').AnswerMeta | undefined} meta - The model's report, if it gave a valid one.
 * @property {Pick<import('../citations/index.js').ValidationResult, 'citedKeys' | 'invalidKeys' | 'inferredKeys'>} validation
 *   What checking the citations found.
 * @property {ReadonlyArray<{ type: string, stale?: boolean }>} sources - The sources the answer cites.
 * @property {ReadonlyArray<string>} folderOnlySentences - Sentences whose only citations are folder listings.
 * @property {ReadonlyArray<string>} uncitedSentences - Sentences that make a claim without a citation.
 */

/** Higher is surer. A rule can only move a level down this list. */
const RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

/** The reason when the model did not report its confidence. */
export const NO_META_REASON = 'The assistant did not report its confidence.';

const REASONS = Object.freeze({
  invalidKeys: 'Some citations pointed at sources that were never fetched and were removed.',
  uncited: 'Some statements have no citation.',
  stale: 'A cited page was last updated more than a year ago.',
  inferred: 'Part of this is an interpretation of the sources, marked with an asterisk.',
  folderOnly:
    'Some statements rest only on a folder listing, which shows what exists but not what the files do.',
  gaps: 'Some parts could not be confirmed.',
  conflicts: 'The documentation and the code disagree.',
  noCitations: 'None of the answer could be tied to a source that was fetched.',
});

/**
 * The rules after the first, in the order they are checked. Each lowers the level to at most `cap`.
 * @param {CapsInput} input - What the rules look at.
 * @returns {Array<{ code: string, applies: boolean, cap: Confidence, reason: string }>} The rules.
 */
function lowerRules({ meta, validation, sources, folderOnlySentences, uncitedSentences }) {
  return [
    {
      code: 'invalid-keys',
      applies: validation.invalidKeys.length > 0,
      cap: 'medium',
      reason: REASONS.invalidKeys,
    },
    {
      code: 'uncited-sentences',
      applies: uncitedSentences.length > 0,
      cap: 'medium',
      reason: REASONS.uncited,
    },
    {
      code: 'stale-page',
      applies: sources.some(({ type, stale }) => type === 'confluence' && stale === true),
      cap: 'medium',
      reason: REASONS.stale,
    },
    {
      code: 'inferred',
      applies: validation.inferredKeys.length > 0,
      cap: 'medium',
      reason: REASONS.inferred,
    },
    {
      code: 'folder-only',
      applies: folderOnlySentences.length > 0,
      cap: 'medium',
      reason: REASONS.folderOnly,
    },
    {
      code: 'gaps',
      applies: (meta?.gaps.length ?? 0) > 0,
      cap: 'medium',
      reason: REASONS.gaps,
    },
    {
      code: 'conflicts',
      applies: (meta?.conflicts.length ?? 0) > 0,
      cap: 'low',
      reason: REASONS.conflicts,
    },
  ];
}

/**
 * Ends a sentence with a full stop if it has no ending mark, so reasons read well joined together.
 * @param {string} reason - A reason.
 * @returns {string} The reason with an ending mark.
 */
function endSentence(reason) {
  return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

/**
 * Decides the final status and confidence. The model's report is the starting point and the
 * application's own findings can only lower it, never raise it:
 * - no valid citation at all turns an answer into "not found";
 * - an invented key, an uncited statement, a stale page, an interpretation (including a statement
 *   resting only on a folder listing) or a gap limits the level to medium;
 * - a conflict between the documentation and the code limits it to low;
 * - a missing or invalid report counts as low, and the other rules still run.
 * Other statuses the model reports (not found, clarify, out of scope) are accepted as they are.
 * @param {CapsInput} input - The model's report and what the application found.
 * @returns {CapsResult} The final status, confidence, reason and the rules that held.
 */
export function applyConfidenceCaps(input) {
  const { meta, validation } = input;
  if (meta !== undefined && meta.status !== 'answered') {
    return {
      status: meta.status,
      confidence: null,
      confidenceReason: endSentence(meta.confidenceReason),
      capsApplied: [],
    };
  }
  // Without a valid report the answer is treated as an answer the model is not sure about.
  const missing = meta === undefined ? [{ code: 'no-meta', reason: NO_META_REASON }] : [];
  if (validation.citedKeys.length === 0) {
    const none = { code: 'no-citations', reason: REASONS.noCitations };
    return {
      status: 'not_found',
      confidence: null,
      confidenceReason: REASONS.noCitations,
      capsApplied: [...missing, none],
    };
  }
  /** @type {Confidence} */
  let level = meta === undefined ? 'low' : /** @type {Confidence} */ (meta.confidence);
  const applied = lowerRules(input).filter(({ applies }) => applies);
  applied.forEach(({ cap }) => {
    level = RANK[cap] < RANK[level] ? cap : level;
  });
  const reported = meta === undefined ? NO_META_REASON : endSentence(meta.confidenceReason);
  return {
    status: 'answered',
    confidence: level,
    confidenceReason: [reported, ...applied.map(({ reason }) => reason)].join(' '),
    capsApplied: [...missing, ...applied.map(({ code, reason }) => ({ code, reason }))],
  };
}

/** The code of the rule that holds when a cited source has changed since it was fetched. */
export const SOURCE_CHANGED_CODE = 'source-changed';

/** The reason a reader is told when a cited source has changed. */
export const SOURCE_CHANGED_REASON = 'A source has changed since this answer was written.';

/**
 * Applies the rule for a changed source to an answer that already has its confidence: when a source
 * it cites has changed since it was fetched, the answer is at most medium, and says why. This is
 * not one of the rules in `applyConfidenceCaps` because it cannot be known when the answer is
 * written: a re-check finds it out later, so it is applied to the finished result, and again to the
 * original result each time a re-check finds something new.
 *
 * It only ever lowers the level, and applying it twice changes nothing more than applying it once.
 * An answer with no confidence (not found, clarify, out of scope) is left alone.
 * @param {CapsResult} caps - The status, confidence and reasons the answer has.
 * @param {ReadonlyArray<string>} changedKeys - The keys of the cited sources found to have changed.
 * @returns {CapsResult} The same object when nothing applies, otherwise a copy with the rule added.
 */
export function applySourceChangeCap(caps, changedKeys) {
  if (changedKeys.length === 0 || caps.status !== 'answered' || caps.confidence === null) {
    return caps;
  }
  const alreadyApplied = caps.capsApplied.some(({ code }) => code === SOURCE_CHANGED_CODE);
  const confidence = RANK.medium < RANK[caps.confidence] ? 'medium' : caps.confidence;
  return {
    ...caps,
    confidence,
    confidenceReason: alreadyApplied
      ? caps.confidenceReason
      : `${caps.confidenceReason} ${SOURCE_CHANGED_REASON}`,
    capsApplied: alreadyApplied
      ? caps.capsApplied
      : [...caps.capsApplied, { code: SOURCE_CHANGED_CODE, reason: SOURCE_CHANGED_REASON }],
  };
}
