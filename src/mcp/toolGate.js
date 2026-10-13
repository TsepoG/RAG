// @ts-check

/**
 * A switch that, once turned, refuses every tool call for the rest of the question. The answer is
 * rewritten after the sources are gathered, and a rewrite must not fetch anything new.
 * @typedef {object} ToolGate
 * @property {() => void} lock - Refuses every tool call from now on. It cannot be undone.
 * @property {() => boolean} isLocked - Whether tool calls are being refused.
 */

/** Said to the model when a call is refused because the gate is locked. */
export const TOOLS_LOCKED_REASON = 'Tools are not available while rewriting.';

/**
 * Creates a gate for one question. It starts open and can only be locked, never reopened, so a
 * bug cannot give a rewrite its tools back.
 * @returns {ToolGate} The gate.
 */
export function createToolGate() {
  let locked = false;
  return {
    lock() {
      locked = true;
    },
    isLocked: () => locked,
  };
}

/**
 * A gate for a conversation: the same as a question's gate within a turn, and a new open one for
 * each turn. A rewrite in one turn locks tools for the rest of that turn only; the next turn must
 * be able to fetch again.
 * @typedef {ToolGate & { startTurn: () => void }} TurnGate
 */

/**
 * Creates the gate for a conversation. `startTurn` swaps in a fresh open gate; nothing else can
 * reopen it, so within a turn it is as one-way as a question's gate.
 * @returns {TurnGate} The gate.
 */
export function createTurnGate() {
  let current = createToolGate();
  return {
    lock: () => current.lock(),
    isLocked: () => current.isLocked(),
    startTurn() {
      current = createToolGate();
    },
  };
}
