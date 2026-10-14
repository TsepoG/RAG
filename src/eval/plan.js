// @ts-check
import { EvalError } from '../errors/index.js';

/**
 * Works out which of the chosen cases a run will ask, before it starts, so the owner can be told
 * what is left out and what it will cost.
 * @param {ReadonlyArray<import('./schema.js').EvalCase>} cases - The chosen cases.
 * @param {object} options - How the run asks them.
 * @param {'single' | 'conversation'} options.path - `single` asks each case on its own and leaves out
 *   a case with several turns; `conversation` asks every case as a conversation.
 * @param {number} options.maxTurns - How many turns a conversation may have (CONVERSATION_MAX_TURNS).
 * @returns {{ runnable: import('./schema.js').EvalCase[], skipped: string[] }} The cases that will be asked, and the ids left out.
 * @throws {EvalError} When, as conversations, a case has more turns than a conversation may have.
 */
export function planRun(cases, { path, maxTurns }) {
  if (path === 'single') {
    return {
      runnable: cases.filter(({ followUps }) => followUps === undefined),
      skipped: cases.filter(({ followUps }) => followUps !== undefined).map(({ id }) => id),
    };
  }
  const tooLong = cases.filter(({ followUps }) => 1 + (followUps?.length ?? 0) > maxTurns);
  if (tooLong.length > 0) {
    throw new EvalError(
      `These cases have more turns than a conversation may have (CONVERSATION_MAX_TURNS is ${maxTurns}): ${tooLong
        .map(({ id }) => id)
        .join(', ')}`,
    );
  }
  return { runnable: [...cases], skipped: [] };
}
