// @ts-check
import { bestEffort, disconnectSession } from '../answer/index.js';

/**
 * Makes the function the store uses to close a conversation's session: it stops a turn that is
 * still running, then disconnects. Neither step can fail or hang the caller.
 * @param {import('../logger/index.js').Logger} logger - Where trouble is logged.
 * @returns {import('./store.js').CloseSession} The closer.
 */
export function createSessionCloser(logger) {
  return async (session, { running }) => {
    const open = /** @type {import('@github/copilot-sdk').CopilotSession} */ (session);
    if (running) {
      await bestEffort('abort the running turn', () => open.abort(), logger);
    }
    await disconnectSession(open, logger);
  };
}
