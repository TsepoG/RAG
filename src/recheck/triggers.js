// @ts-check

const MS_PER_MINUTE = 60_000;

/**
 * What decides which sources are checked after a turn.
 * @typedef {object} TriggerInput
 * @property {ReadonlyArray<import('../citations/index.js').RegisteredSource>} turnSources - The sources the turn's answer cites.
 * @property {ReadonlyArray<import('../citations/index.js').RegisteredSource>} conversationSources - Every source cited anywhere in the conversation.
 * @property {number} turn - The turn that has just been answered.
 * @property {boolean} isLastTurn - Whether the conversation can take no more questions.
 * @property {number} now - The time, in ms.
 * @property {number} afterMinutes - How old a source may get, and how long since a check counts as recent (RECHECK_AFTER_MINUTES).
 * @property {(key: string) => number | undefined} lastCheckedAt - When a source was last checked, if it was.
 */

/**
 * Whether a source is worth looking at: it can be compared, and a newer state has not already
 * replaced it.
 * @param {import('../citations/index.js').RegisteredSource} source - The source.
 * @returns {boolean} True when a check could tell something.
 */
function isCheckable(source) {
  return source.fingerprint !== undefined && source.changed !== true;
}

/**
 * Chooses the sources to check on their own after a turn. Pure. A source is checked when the
 * answer cites it and either an earlier turn fetched it or it is older than `afterMinutes`, but
 * not when it was checked within that time. When the conversation is full, every checkable source
 * cited anywhere in it is checked, once more, so that nothing is left unchecked at the end; the
 * ones just checked are still skipped.
 * @param {TriggerInput} input - The sources and the times.
 * @returns {import('../citations/index.js').RegisteredSource[]} The sources to check.
 */
export function selectForAutoRecheck({
  turnSources,
  conversationSources,
  turn,
  isLastTurn,
  now,
  afterMinutes,
  lastCheckedAt,
}) {
  const windowMs = afterMinutes * MS_PER_MINUTE;
  const checkedRecently = (
    /** @type {import('../citations/index.js').RegisteredSource} */ { key },
  ) => {
    const checked = lastCheckedAt(key);
    return checked !== undefined && now - checked < windowMs;
  };
  const isDue = (/** @type {import('../citations/index.js').RegisteredSource} */ source) =>
    (source.fetchedInTurn ?? turn) < turn || now - (source.fetchedAt ?? now) >= windowMs;
  const candidates = isLastTurn ? conversationSources : turnSources.filter(isDue);
  return candidates.filter((source) => isCheckable(source) && !checkedRecently(source));
}
