// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCitationRegistry } from '../../src/citations/index.js';
import { loadConfig } from '../../src/config/index.js';
import {
  AppError,
  AskTimeoutError,
  CopilotError,
  QuestionCancelledError,
} from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createToolGate } from '../../src/mcp/index.js';
import {
  buildQuestionHooks,
  createLookups,
  createNotifier,
  disconnectSession,
  startInterrupt,
  toTurnError,
} from '../../src/answer/stages.js';
import { validEnv } from '../helpers/env.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A logger that records what it is given.
 * @returns {{ logger: import('../../src/logger/index.js').Logger, lines: () => Array<Record<string, unknown>> }} The logger and its lines.
 */
function makeLogger() {
  const { stream, lines } = createMemoryStream();
  return { logger: createLogger({ level: 'debug', destination: stream }), lines };
}

describe('createNotifier', () => {
  it('passes the activity on to the receiver', () => {
    const received = /** @type {unknown[]} */ ([]);
    const { logger } = makeLogger();

    createNotifier((activity) => received.push(activity), logger)({ kind: 'checking' });

    expect(received).toEqual([{ kind: 'checking' }]);
  });

  it('does nothing without a receiver', () => {
    const { logger, lines } = makeLogger();

    createNotifier(undefined, logger)({ kind: 'checking' });

    expect(lines()).toEqual([]);
  });

  it('logs and drops a failure of the receiver, so a progress display cannot fail the question', () => {
    const { logger, lines } = makeLogger();
    const notify = createNotifier(() => {
      throw new Error('the stream is closed');
    }, logger);

    expect(() => notify({ kind: 'checking' })).not.toThrow();
    expect(lines()).toContainEqual(expect.objectContaining({ msg: 'could not report progress' }));
  });
});

describe('startInterrupt', () => {
  it('rejects with a timeout when the time runs out', async () => {
    vi.useFakeTimers();
    const { interrupt, stop } = startInterrupt({ askTimeoutMs: 1000, signal: undefined });
    const outcome = interrupt.catch((error) => error);

    await vi.advanceTimersByTimeAsync(1000);

    expect(await outcome).toBeInstanceOf(AskTimeoutError);
    stop();
  });

  it('rejects with a cancellation when the signal is aborted, on both promises', async () => {
    const controller = new AbortController();
    const { interrupt, cancellation, stop } = startInterrupt({
      askTimeoutMs: 60_000,
      signal: controller.signal,
    });

    controller.abort();

    expect(await interrupt.catch((error) => error)).toBeInstanceOf(QuestionCancelledError);
    expect(await cancellation.catch((error) => error)).toBeInstanceOf(QuestionCancelledError);
    stop();
  });

  it('does not time out the cancellation promise, which only a stop settles', async () => {
    vi.useFakeTimers();
    const { interrupt, cancellation, stop } = startInterrupt({
      askTimeoutMs: 500,
      signal: undefined,
    });
    const settled = vi.fn();
    cancellation.then(settled, settled);
    interrupt.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(5000);

    expect(settled).not.toHaveBeenCalled();
    stop();
  });

  it('stops the timer when the question is over, so nothing is rejected afterwards', async () => {
    vi.useFakeTimers();
    const { interrupt, stop } = startInterrupt({ askTimeoutMs: 1000, signal: undefined });
    const settled = vi.fn();
    interrupt.then(settled, settled);

    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(settled).not.toHaveBeenCalled();
  });
});

describe('createLookups and buildQuestionHooks', () => {
  const config = loadConfig(validEnv());

  it('gives the head commit lookup and the CODEOWNERS lookup', () => {
    const { logger } = makeLogger();

    const { commits, owners } = createLookups({ config, fetch: undefined, logger });

    expect(typeof commits.resolveHead).toBe('function');
    expect(typeof owners.ownersOf).toBe('function');
  });

  it('builds hooks that check a call against the configured repositories', async () => {
    const { logger } = makeLogger();
    const hooks = buildQuestionHooks({
      config,
      registry: createCitationRegistry(),
      gate: createToolGate(),
      commits: { resolveHead: async () => undefined },
      logger,
      clock: { now: () => 0 },
    });

    const call = /** @type {any} */ ({
      toolName: 'github_repos-get_file_contents',
      toolArgs: { owner: 'someone-else', repo: 'elsewhere', path: 'a.js' },
    });
    const decision = await hooks.onPreToolUse?.(call, { sessionId: 's' });

    expect(decision).toMatchObject({ permissionDecision: 'deny' });
  });
});

describe('toTurnError', () => {
  /**
   * A session whose abort and disconnect are spies.
   * @returns {any} The session.
   */
  function makeSession() {
    return { abort: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) };
  }

  it.each([
    ['a timeout', new AskTimeoutError(1000)],
    ['a stop by the person asking', new QuestionCancelledError()],
  ])('aborts the session after %s, and passes the error on', async (_name, error) => {
    const session = makeSession();
    const { logger } = makeLogger();

    const result = await toTurnError(error, { session, logger });

    expect(result).toBe(error);
    expect(session.abort).toHaveBeenCalledOnce();
  });

  it('logs that a cancelled question is being aborted', async () => {
    const { logger, lines } = makeLogger();

    await toTurnError(new QuestionCancelledError(), { session: makeSession(), logger });

    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'the question was cancelled; aborting the session' }),
    );
  });

  it('does not abort for an error that is not an interruption', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    const error = new AppError('A question is required');

    expect(await toTurnError(error, { session, logger })).toBe(error);
    expect(session.abort).not.toHaveBeenCalled();
  });

  it('wraps an error of any other kind, keeping the cause', async () => {
    const { logger } = makeLogger();
    const cause = new Error('boom');

    const result = await toTurnError(cause, { session: undefined, logger });

    expect(result).toBeInstanceOf(CopilotError);
    expect(result.message).toBe('Copilot could not answer the question');
    expect(result.cause).toBe(cause);
  });

  it('copes with an interruption before any session was opened', async () => {
    const { logger } = makeLogger();
    const error = new AskTimeoutError(1000);

    expect(await toTurnError(error, { session: undefined, logger })).toBe(error);
  });
});

describe('disconnectSession', () => {
  it('disconnects an open session', async () => {
    const session = /** @type {any} */ ({ disconnect: vi.fn(async () => undefined) });
    const { logger } = makeLogger();

    await disconnectSession(session, logger);

    expect(session.disconnect).toHaveBeenCalledOnce();
  });

  it('does nothing when no session was opened', async () => {
    const { logger, lines } = makeLogger();

    await disconnectSession(undefined, logger);

    expect(lines()).toEqual([]);
  });

  it('logs a failure to disconnect and does not throw', async () => {
    const session = /** @type {any} */ ({
      disconnect: vi.fn(async () => {
        throw new Error('already closed');
      }),
    });
    const { logger, lines } = makeLogger();

    await expect(disconnectSession(session, logger)).resolves.toBeUndefined();
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'could not disconnect the session' }),
    );
  });
});
