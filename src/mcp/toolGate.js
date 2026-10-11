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
