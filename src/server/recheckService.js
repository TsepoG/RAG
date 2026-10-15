// @ts-check
import { recheckSources, selectForAutoRecheck } from '../recheck/index.js';
import { citedKeysOf, wasAnswered } from './conversationView.js';

/** How many re-checks may run at once, whichever conversation or trigger started them. */
export const MAX_CONCURRENT_RECHECKS = 4;

/** A manual re-check within this long of the last one is ignored, in ms. */
export const MANUAL_RECHECK_INTERVAL_MS = 30_000;

/**
 * What came of asking for a re-check.
 * @typedef {{ kind: 'ignored' } | { kind: 'busy' } | {
 *   kind: 'done',
 *   results: import('../recheck/index.js').CheckResult[],
 *   changedKeys: string[],
 * }} RecheckOutcome
 */

/**
 * Runs re-checks for conversations: it checks sources against the live Confluence and GitHub
 * (never Copilot), keeps the results, and marks a source changed in the conversation's registry.
 * It limits how many run at once and ignores a manual check made too soon after the last.
 * @typedef {object} RecheckService
 * @property {(conversation: import('../conversation/index.js').Conversation, keys: ReadonlyArray<string>) => Promise<RecheckOutcome>} manual -
 *   Checks the given sources because the reader asked; ignored within 30 seconds of the last such request.
 * @property {(conversation: import('../conversation/index.js').Conversation, turn: number) => Promise<RecheckOutcome>} auto -
 *   Checks the sources that are due after an answered turn, as the triggers say.
 */

/**
 * Creates the service.
 * @param {object} deps - What it needs.
 * @param {Omit<import('../recheck/index.js').Checkers, 'clock'>} deps.checkers - The GitHub and Confluence checkers.
 * @param {{ now: () => number }} deps.clock - Time source.
 * @param {number} deps.afterMinutes - How old a source may get before an automatic check (RECHECK_AFTER_MINUTES).
 * @param {Pick<import('../logger/index.js').Logger, 'info'>} deps.logger - Where it notes what it ignored.
 * @returns {RecheckService} The service.
 */
export function createRecheckService({ checkers, clock, afterMinutes, logger }) {
  let running = 0;

  /**
   * Checks sources and records what was found.
   * @param {import('../conversation/index.js').Conversation} conversation - The conversation.
   * @param {ReadonlyArray<import('../citations/index.js').RegisteredSource>} sources - The sources.
   * @param {() => void} [onStart] - Called once a place is taken, before anything is checked.
   * @returns {Promise<RecheckOutcome>} The outcome.
   */
  async function run(conversation, sources, onStart = () => undefined) {
    if (running >= MAX_CONCURRENT_RECHECKS) {
      logger.info({}, 'did not re-check: too many re-checks are running');
      return { kind: 'busy' };
    }
    running += 1;
    try {
      onStart();
      const results = await recheckSources(sources, { ...checkers, clock });
      conversation.checks.record(results);
      const changedKeys = results
        .filter(({ status }) => status === 'changed')
        .map(({ key }) => key);
      changedKeys.forEach((key) => conversation.registry.markChanged(key));
      return { kind: 'done', results, changedKeys };
    } finally {
      running -= 1;
    }
  }

  /**
   * Looks up the sources behind some keys.
   * @param {import('../conversation/index.js').Conversation} conversation - The conversation.
   * @param {ReadonlyArray<string>} keys - The keys.
   * @returns {import('../citations/index.js').RegisteredSource[]} The sources that exist.
   */
  function sourcesOf(conversation, keys) {
    return keys.flatMap((key) => conversation.registry.get(key) ?? []);
  }

  return {
    async manual(conversation, keys) {
      const last = conversation.checks.lastManualAt();
      const now = clock.now();
      if (last !== undefined && now - last < MANUAL_RECHECK_INTERVAL_MS) {
        logger.info({}, 'ignored a re-check asked for too soon after the last');
        return { kind: 'ignored' };
      }
      // The 30 seconds start only when a check really starts, so a refusal for being busy is not held against the reader.
      return run(conversation, sourcesOf(conversation, keys), () =>
        conversation.checks.markManual(now),
      );
    },
    async auto(conversation, turn) {
      const answered = conversation.turns().filter(wasAnswered);
      const thisTurn = answered.find((record) => record.turn === turn);
      const everyKey = [...new Set(answered.flatMap(citedKeysOf))];
      const due = selectForAutoRecheck({
        turnSources: sourcesOf(conversation, thisTurn === undefined ? [] : citedKeysOf(thisTurn)),
        conversationSources: sourcesOf(conversation, everyKey),
        turn,
        isLastTurn:
          conversation.fullReason() !== undefined || conversation.endedReason() !== undefined,
        now: clock.now(),
        afterMinutes,
        lastCheckedAt: (key) => conversation.checks.lastCheckedAt(key),
      });
      return run(conversation, due);
    },
  };
}
