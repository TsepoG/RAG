// @ts-check

/** What every follow-up is told; the system message stays as it was in the first turn. */
const FOLLOW_UP_NOTE =
  'Follow-up in the same conversation. You may cite sources already fetched by their keys; ' +
  "fetch again if you need content you haven't seen. End with the answer-meta block.";

/** Added when the reader asked for more detail, since the system message cannot change. */
const MORE_DETAIL_NOTE =
  'The reader asked for more detail: answer one step more technically than your last answer, ' +
  'and name the parts of the system where that helps.';

/**
 * Says which sources changed, so the model reads them again.
 * @param {ReadonlyArray<string>} keys - The keys of the changed sources.
 * @returns {string} The sentence.
 */
function changedNote(keys) {
  return (
    `These sources have changed since you read them: ${keys.join(', ')}. Fetch them again and ` +
    'answer from the new versions; the new versions get new keys.'
  );
}

/**
 * Builds the short note that goes in front of a follow-up question. The first turn has none: its
 * prompt is the question alone. Earlier turns are history, and are data, not instructions.
 * @param {object} input - What the turn is.
 * @param {number} input.turn - The turn, from 1.
 * @param {import('../roles/index.js').DetailLevel} [input.detailLevel] - `more` for a request for more detail.
 * @param {ReadonlyArray<string>} [input.changedKeys] - Sources to read again because they changed.
 * @returns {string} The note, or an empty string for the first turn.
 */
export function buildTurnNote({ turn, detailLevel = 'default', changedKeys = [] }) {
  if (turn <= 1) {
    return '';
  }
  return [
    FOLLOW_UP_NOTE,
    ...(detailLevel === 'more' ? [MORE_DETAIL_NOTE] : []),
    ...(changedKeys.length > 0 ? [changedNote(changedKeys)] : []),
  ].join(' ');
}
