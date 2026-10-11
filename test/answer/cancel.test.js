// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCancellation } from '../../src/answer/deadline.js';
import { QuestionCancelledError } from '../../src/errors/index.js';
import { ask, BUSINESS_ROLE, FILE, PAGE, reply, WINDOW } from '../helpers/ask.js';

const WITH_CODE = `The \`refund()\` call decides the refund window for every order [C1].`;
const PLAIN = `${WINDOW} for every order we take [C1].`;

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A turn that reports a tool call, then answers.
 * @param {string} text - The reply.
 * @param {{ server?: string, tool: string, id: string, args?: Record<string, unknown> }} call - The call.
 * @returns {(context: { emit: (type: string, data: Record<string, unknown>) => void }) => void} The turn.
 */
function usesATool(text, { server = 'atlassian', tool, id, args = {} }) {
  return ({ emit }) => {
    emit('tool.execution_start', {
      toolCallId: id,
      mcpServerName: server,
      mcpToolName: tool,
      toolName: `${server}-${tool}`,
      arguments: args,
    });
    emit('tool.execution_complete', { toolCallId: id, success: true });
    emit('assistant.message', { content: text });
    emit('session.idle', {});
  };
}

describe('askQuestion cancellation', () => {
  it('throws at once, and opens no session, when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const capture = /** @type {any} */ ({});

    const failure = await ask({
      signal: controller.signal,
      capture,
      replies: [reply(`${WINDOW} [C1].`)],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(QuestionCancelledError);
    expect(failure.message).toBe('The question was cancelled');
    expect(capture.client.createSession).not.toHaveBeenCalled();
  });

  it('aborts and disconnects the session once each, and logs it, when stopped while it works', async () => {
    const controller = new AbortController();
    const capture = /** @type {any} */ ({});

    const failure = await ask({
      signal: controller.signal,
      capture,
      replies: [() => controller.abort()],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(QuestionCancelledError);
    expect(capture.session.abort).toHaveBeenCalledOnce();
    expect(capture.session.disconnect).toHaveBeenCalledOnce();
    expect(capture.lines()).toContainEqual(
      expect.objectContaining({ msg: 'the question was cancelled; aborting the session' }),
    );
  });

  it('does not keep the first answer when stopped during the rewrite: the question is cancelled', async () => {
    const controller = new AbortController();
    const capture = /** @type {any} */ ({});

    const failure = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      signal: controller.signal,
      capture,
      replies: [reply(WITH_CODE), () => controller.abort()],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(QuestionCancelledError);
    expect(capture.session.sent).toHaveLength(2);
    expect(capture.session.abort).toHaveBeenCalledOnce();
    expect(capture.session.disconnect).toHaveBeenCalledOnce();
  });

  it('stops while it is looking up who to ask, without waiting for GitHub', async () => {
    const controller = new AbortController();
    const never = /** @type {typeof fetch} */ (vi.fn(() => new Promise(() => undefined)));
    setTimeout(() => controller.abort(), 20);

    const failure = await ask({
      tools: [FILE],
      signal: controller.signal,
      fetchFunction: never,
      replies: [reply('Nothing.', { status: 'not_found', confidence: undefined })],
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(QuestionCancelledError);
  });

  it('returns the answer, and ignores a stop that comes afterwards', async () => {
    const controller = new AbortController();
    const capture = /** @type {any} */ ({});

    const { result } = await ask({
      tools: [PAGE],
      signal: controller.signal,
      capture,
      replies: [reply(`${WINDOW} [C1].`)],
    });
    controller.abort();
    await Promise.resolve();

    expect(result.status).toBe('answered');
    expect(capture.session.abort).not.toHaveBeenCalled();
  });

  it('is not cancelled when no signal is given', async () => {
    const { result } = await ask({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });

    expect(result.status).toBe('answered');
  });
});

describe('createCancellation', () => {
  it('never settles when there is no signal', async () => {
    const { promise } = createCancellation(undefined);

    const winner = await Promise.race([promise, Promise.resolve('still waiting')]);

    expect(winner).toBe('still waiting');
  });

  it('rejects with a QuestionCancelledError when the signal is aborted', async () => {
    const controller = new AbortController();
    const { promise } = createCancellation(controller.signal);

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(QuestionCancelledError);
  });

  it('rejects at once when the signal was aborted already', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(createCancellation(controller.signal).promise).rejects.toBeInstanceOf(
      QuestionCancelledError,
    );
  });

  it('stops listening once cancelled, so a later abort changes nothing', async () => {
    const controller = new AbortController();
    const watch = createCancellation(controller.signal);

    watch.cancel();
    controller.abort();

    const winner = await Promise.race([watch.promise, Promise.resolve('unchanged')]);
    expect(winner).toBe('unchanged');
  });

  it('can be cancelled when there is no signal', () => {
    expect(() => createCancellation(undefined).cancel()).not.toThrow();
  });
});

describe('askQuestion progress', () => {
  it('tells the caller which tool each call is, in order, then that it is checking', async () => {
    const seen = /** @type {any[]} */ ([]);

    await ask({
      tools: [],
      onActivity: (activity) => seen.push(activity),
      replies: [
        usesATool(reply('Nothing found.', { status: 'not_found', confidence: undefined }), {
          tool: 'searchConfluence',
          id: 't1',
        }),
      ],
    });

    expect(seen).toEqual([
      { kind: 'tool', server: 'atlassian', tool: 'searchConfluence' },
      { kind: 'checking' },
    ]);
  });

  it('names a tool the runtime did not describe as unknown, using its plain name', async () => {
    const seen = /** @type {any[]} */ ([]);

    await ask({
      onActivity: (activity) => seen.push(activity),
      replies: [
        ({ emit }) => {
          emit('tool.execution_start', { toolCallId: 't1', toolName: 'view', arguments: {} });
          emit('assistant.message', {
            content: reply('Nothing.', { status: 'not_found', confidence: undefined }),
          });
          emit('session.idle', {});
        },
      ],
    });

    expect(seen[0]).toEqual({ kind: 'tool', server: 'unknown', tool: 'view' });
  });

  it('never puts the arguments of a call in what it reports', async () => {
    const seen = /** @type {any[]} */ ([]);

    await ask({
      onActivity: (activity) => seen.push(activity),
      replies: [
        usesATool(reply('Nothing.', { status: 'not_found', confidence: undefined }), {
          tool: 'searchConfluence',
          id: 't1',
          args: { cql: 'space = SECRET', token: 'abc123' },
        }),
      ],
    });

    expect(JSON.stringify(seen)).not.toMatch(/SECRET|abc123|cql/);
  });

  it('reports that it is rewriting, after checking, and before the answer comes back', async () => {
    const seen = /** @type {any[]} */ ([]);

    await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      onActivity: (activity) => seen.push(activity),
      replies: [reply(WITH_CODE), reply(PLAIN)],
    });

    expect(seen.map(({ kind }) => kind)).toEqual(['checking', 'rewriting']);
  });

  it('does not report rewriting when the answer already suits the role', async () => {
    const seen = /** @type {any[]} */ ([]);

    await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      onActivity: (activity) => seen.push(activity),
      replies: [reply(PLAIN)],
    });

    expect(seen.map(({ kind }) => kind)).toEqual(['checking']);
  });

  it('carries on, and logs it, when reporting progress fails', async () => {
    const { result, lines } = await ask({
      tools: [FILE],
      onActivity: () => {
        throw new Error('the stream is closed');
      },
      replies: [reply(`${WINDOW} [G1].`)],
    });

    expect(result.status).toBe('answered');
    expect(lines()).toContainEqual(expect.objectContaining({ msg: 'could not report progress' }));
  });

  it('asks nothing of the caller when no one is listening', async () => {
    const { result } = await ask({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });

    expect(result.status).toBe('answered');
  });
});
