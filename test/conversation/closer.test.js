// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createSessionCloser } from '../../src/conversation/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

/**
 * A closer with a session that records what is done to it.
 * @param {{ abortError?: Error, disconnectError?: Error }} [failures] - What should fail.
 * @returns {{ close: ReturnType<typeof createSessionCloser>, session: any, lines: () => Array<Record<string, unknown>> }} The closer and its doubles.
 */
function setup({ abortError, disconnectError } = {}) {
  const { stream, lines } = createMemoryStream();
  const order = /** @type {string[]} */ ([]);
  const session = {
    order,
    abort: vi.fn(async () => {
      order.push('abort');
      if (abortError) {
        throw abortError;
      }
    }),
    disconnect: vi.fn(async () => {
      order.push('disconnect');
      if (disconnectError) {
        throw disconnectError;
      }
    }),
  };
  return {
    close: createSessionCloser(createLogger({ level: 'debug', destination: stream })),
    session,
    lines,
  };
}

describe('createSessionCloser', () => {
  it('only disconnects a session that is not running a turn', async () => {
    const { close, session } = setup();

    await close(session, { running: false });

    expect(session.order).toEqual(['disconnect']);
  });

  it('aborts the running turn first, then disconnects', async () => {
    const { close, session } = setup();

    await close(session, { running: true });

    expect(session.order).toEqual(['abort', 'disconnect']);
  });

  it('still disconnects, and logs, when the abort fails', async () => {
    const { close, session, lines } = setup({ abortError: new Error('gone') });

    await close(session, { running: true });

    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: 'could not abort the running turn' }),
    );
  });

  it('does not throw when the disconnect fails', async () => {
    const { close, session, lines } = setup({ disconnectError: new Error('gone') });

    await expect(close(session, { running: false })).resolves.toBeUndefined();
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'could not disconnect the session' }),
    );
  });
});
