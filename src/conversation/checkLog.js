// @ts-check

/**
 * What the last check of a source found, and when.
 * @typedef {object} SourceCheck
 * @property {'unchanged' | 'changed' | 'unavailable'} status - Whether it is the same, changed, or could not be checked.
 * @property {number} checkedAt - When the check finished, in ms.
 */

/**
 * A conversation's record of its re-checks: the latest result for each source key, and when the
 * reader last asked for a check by hand.
 * @typedef {object} CheckLog
 * @property {(results: ReadonlyArray<SourceCheck & { key: string }>) => void} record - Keeps the latest result for each key.
 * @property {(key: string) => SourceCheck | undefined} get - The latest result for a key.
 * @property {(key: string) => number | undefined} lastCheckedAt - When a key was last checked.
 * @property {(now: number) => void} markManual - Notes that the reader asked for a check at this time.
 * @property {() => number | undefined} lastManualAt - When they last asked, if they did.
 */

/**
 * Creates an empty log.
 * @returns {CheckLog} The log.
 */
export function createCheckLog() {
  /** @type {Map<string, SourceCheck>} */
  const byKey = new Map();
  /** @type {number | undefined} */
  let manualAt;
  return {
    record(results) {
      for (const { key, status, checkedAt } of results) {
        byKey.set(key, Object.freeze({ status, checkedAt }));
      }
    },
    get: (key) => byKey.get(key),
    lastCheckedAt: (key) => byKey.get(key)?.checkedAt,
    markManual(now) {
      manualAt = now;
    },
    lastManualAt: () => manualAt,
  };
}
