// @ts-check
import { vi } from 'vitest';

/**
 * What a fake session should do, beyond recording calls.
 * @typedef {object} FakeSessionBehaviour
 * @property {(emit: (type: string, data: Record<string, unknown>) => void) => void | Promise<void>} [script] -
 *   Called from `send`; emits the events the session would produce.
 * @property {Error} [sendError] - Makes `send` reject.
 * @property {Error} [abortError] - Makes `abort` reject.
 * @property {Error} [disconnectError] - Makes `disconnect` reject.
 * @property {boolean} [hangOnDisconnect] - Makes `disconnect` never finish.
 */

/**
 * Builds a stand-in for a Copilot session. It registers handlers like the real one, records every
 * call, and replays events from a script when a message is sent.
 * @param {FakeSessionBehaviour} [behaviour] - How it should behave.
 * @returns {any} The fake session, with `emit`, `sent` and the vi mocks for `abort` and `disconnect`.
 */
export function createFakeSession({
  script,
  sendError,
  abortError,
  disconnectError,
  hangOnDisconnect = false,
} = {}) {
  /** @type {Map<string, Array<(event: unknown) => void>>} */
  const handlers = new Map();
  const sent = /** @type {Array<{ prompt: string }>} */ ([]);

  /**
   * Delivers an event to everything registered for its type.
   * @param {string} type - Event type.
   * @param {Record<string, unknown>} data - Event data.
   */
  const emit = (type, data) => {
    (handlers.get(type) ?? []).forEach((handler) => handler({ type, data }));
  };

  return {
    sent,
    emit,
    listenerCount: () => [...handlers.values()].reduce((total, list) => total + list.length, 0),
    on: vi.fn((type, handler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      return () => {
        handlers.set(
          type,
          (handlers.get(type) ?? []).filter((registered) => registered !== handler),
        );
      };
    }),
    send: vi.fn(async (options) => {
      sent.push(options);
      if (sendError) {
        throw sendError;
      }
      await script?.(emit);
      return 'message-1';
    }),
    abort: vi.fn(async () => {
      if (abortError) {
        throw abortError;
      }
    }),
    disconnect: vi.fn(() => {
      if (hangOnDisconnect) {
        return new Promise(() => undefined);
      }
      return disconnectError ? Promise.reject(disconnectError) : Promise.resolve();
    }),
  };
}

/**
 * Builds a stand-in for a started client that hands out the given session and records the config.
 * @param {any} session - The session `createSession` should return.
 * @param {Error} [failure] - Makes `createSession` reject.
 * @returns {{ createSession: import('vitest').Mock, configs: any[] }} The fake client and the
 *   session configs it was given.
 */
export function createFakeClient(session, failure) {
  const configs = /** @type {any[]} */ ([]);
  return {
    configs,
    createSession: vi.fn(async (config) => {
      configs.push(config);
      if (failure) {
        throw failure;
      }
      return session;
    }),
  };
}
