// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askQuestion } from '../../src/answer/askQuestion.js';
import { encodeBasicCredentials, loadConfig } from '../../src/config/index.js';
import { AppError, AskTimeoutError, CopilotError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createFakeClient, createFakeSession } from '../helpers/fake-session.js';
import { FAKE_ATLASSIAN_TOKEN, validEnv } from '../helpers/env.js';
import { TEST_ROLE } from '../helpers/role.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const WORKING_DIRECTORY = 'sandbox/work';
const FENCE = '```';

/**
 * Writes a reply that asks one clarifying question, with the report the model must end with. It is
 * the simplest reply that needs no sources, so tests of the plumbing can read the answer back.
 * @param {string} question - The question.
 * @returns {string} The reply.
 */
function clarifyReply(question) {
  const meta = {
    status: 'clarify',
    confidenceReason: 'Two things fit.',
    gaps: [],
    conflicts: [],
    clarifyingQuestion: question,
  };
  return question + '\n\n' + FENCE + 'answer-meta\n' + JSON.stringify(meta) + '\n' + FENCE;
}

/**
 * A fake session that finishes at once, as a question that needs no tools would.
 * @returns {any} The fake session.
 */
function idleSession() {
  return createFakeSession({ script: (emit) => emit('session.idle', {}) });
}

/**
 * Sets up everything `askQuestion` needs, with a clock the test controls.
 * @param {{ session?: any, createFailure?: Error, env?: Record<string, string | undefined> }} [options]
 *   The fake session, a failure for createSession, and environment overrides.
 * @returns {{ deps: import('../../src/answer/askQuestion.js').AskDeps, session: any, client: ReturnType<typeof createFakeClient>, lines: () => Array<Record<string, unknown>>, setTime: (ms: number) => void }}
 *   The dependencies and the fakes behind them.
 */
function setup({ session = idleSession(), createFailure, env = {} } = {}) {
  const { stream, lines } = createMemoryStream();
  const client = createFakeClient(session, createFailure);
  let time = 1000;
  return {
    session,
    client,
    lines,
    setTime: (ms) => (time = ms),
    deps: {
      client,
      workingDirectory: WORKING_DIRECTORY,
      config: loadConfig(validEnv(env)),
      logger: createLogger({ level: 'debug', destination: stream }),
      clock: { now: () => time },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('askQuestion input', () => {
  it.each(['', '   ', '\n\t'])(
    'refuses the blank question %j without opening a session',
    async (question) => {
      const { deps, client } = setup();

      const failure = await askQuestion({ role: TEST_ROLE, question }, deps).catch(
        (error) => error,
      );

      expect(failure).toBeInstanceOf(AppError);
      expect(failure.message).toBe('A question is required');
      expect(client.createSession).not.toHaveBeenCalled();
    },
  );
});

describe('askQuestion answer', () => {
  it('sends the question and returns the final message, the model and how long it took', async () => {
    const session = createFakeSession({
      script(emit) {
        emit('assistant.usage', { model: 'gpt-x' });
        emit('assistant.message', { content: clarifyReply('Which service do you mean?') });
        emit('session.idle', {});
      },
    });
    const { deps, setTime } = setup({ session });
    setTime(1000);

    const resultPromise = askQuestion(
      { role: TEST_ROLE, question: 'Where is the retry logic?' },
      deps,
    );
    setTime(1750);
    const result = await resultPromise;

    expect(session.sent).toEqual([{ prompt: 'Where is the retry logic?' }]);
    expect(result).toEqual({
      status: 'clarify',
      confidence: null,
      confidenceReason: 'Two things fit.',
      capsApplied: [],
      answer: 'Which service do you mean?',
      clarifyingQuestion: 'Which service do you mean?',
      role: 'tester',
      sources: [],
      alsoConsulted: [],
      invalidKeys: [],
      uncitedSourceKeys: [],
      inferredKeys: [],
      gaps: [],
      conflicts: [],
      uncitedSentences: [],
      styleViolations: [],
      rewritten: false,
      rewriteRejected: false,
      whoToAsk: [],
      toolCalls: [],
      model: 'gpt-x',
      durationMs: 750,
    });
  });

  it('streams each piece of the answer, in order, to onDelta', async () => {
    const session = createFakeSession({
      script(emit) {
        emit('assistant.message_delta', { deltaContent: 'Hel' });
        emit('assistant.message_delta', { deltaContent: 'lo' });
        emit('assistant.message', { content: 'Hello' });
        emit('session.idle', {});
      },
    });
    const { deps } = setup({ session });
    const pieces = /** @type {string[]} */ ([]);

    await askQuestion(
      { role: TEST_ROLE, question: 'Hi?', onDelta: (text) => pieces.push(text) },
      deps,
    );

    expect(pieces).toEqual(['Hel', 'lo']);
  });

  it('falls back to the streamed text when no full message arrives', async () => {
    const session = createFakeSession({
      script(emit) {
        const reply = clarifyReply('Streamed only?');
        emit('assistant.message_delta', { deltaContent: reply.slice(0, 10) });
        emit('assistant.message_delta', { deltaContent: reply.slice(10) });
        emit('session.idle', {});
      },
    });
    const { deps } = setup({ session });

    const { answer } = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(answer).toBe('Streamed only?');
  });

  it('uses the last full message as the answer, not the text from earlier tool-calling turns', async () => {
    const session = createFakeSession({
      script(emit) {
        emit('assistant.message_delta', { deltaContent: 'Let me search. ' });
        emit('assistant.message', { content: 'Let me search.' });
        emit('assistant.message_delta', { deltaContent: 'Found it.' });
        emit('assistant.message', { content: clarifyReply('Found it?') });
        emit('assistant.message', { content: '   ' });
        emit('session.idle', {});
      },
    });
    const { deps } = setup({ session });

    const { answer } = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(answer).toBe('Found it?');
  });

  it.each([
    [
      'takes the model from the message when no usage is reported',
      [['assistant.message', { content: 'a', model: 'from-message' }]],
      'from-message',
    ],
    [
      'lets a later usage report replace it',
      [
        ['assistant.message', { content: 'a', model: 'from-message' }],
        ['assistant.usage', { model: 'from-usage' }],
      ],
      'from-usage',
    ],
    [
      'keeps the model when a later message does not name one',
      [
        ['assistant.usage', { model: 'from-usage' }],
        ['assistant.message', { content: 'a' }],
      ],
      'from-usage',
    ],
    ['reports no model when none is named', [['assistant.message', { content: 'a' }]], undefined],
  ])('%s', async (_name, events, expected) => {
    const session = createFakeSession({
      script(emit) {
        // The table rows are written as plain arrays, so they are read here as [type, data] pairs.
        /** @type {Array<[string, Record<string, unknown>]>} */ (events).forEach(([type, data]) =>
          emit(type, data),
        );
        emit('session.idle', {});
      },
    });
    const { deps } = setup({ session });

    const { model } = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(model).toBe(expected);
  });
});

describe('askQuestion tool calls', () => {
  it('records each tool call with its server, tool, arguments and duration', async () => {
    const { deps, setTime } = setup({
      session: createFakeSession({
        script(emit) {
          emit('tool.execution_start', {
            toolCallId: 'c1',
            toolName: 'github_repos-get_file_contents',
            mcpServerName: 'github_repos',
            mcpToolName: 'get_file_contents',
            arguments: { owner: 'acme', repo: 'app', path: 'README.md' },
          });
          emit('tool.execution_complete', { toolCallId: 'c1', success: true });
          emit('assistant.message', { content: 'done' });
          emit('session.idle', {});
        },
      }),
    });
    setTime(1000);

    const result = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(result.toolCalls).toEqual([
      {
        server: 'github_repos',
        tool: 'get_file_contents',
        summary: 'owner=acme, repo=app, path=README.md',
        durationMs: 0,
        success: true,
      },
    ]);
  });

  it('records a failed tool call as unsuccessful and a call that never finished as unfinished', async () => {
    const { deps } = setup({
      session: createFakeSession({
        script(emit) {
          emit('tool.execution_start', {
            toolCallId: 'c1',
            toolName: 'a',
            mcpServerName: 's',
            mcpToolName: 'a',
          });
          emit('tool.execution_start', {
            toolCallId: 'c2',
            toolName: 'b',
            mcpServerName: 's',
            mcpToolName: 'b',
          });
          emit('tool.execution_complete', { toolCallId: 'c1', success: false });
          emit('session.idle', {});
        },
      }),
    });

    const { toolCalls } = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(toolCalls.map(({ tool, success }) => [tool, success])).toEqual([
      ['a', false],
      ['b', undefined],
    ]);
  });
});

describe('askQuestion session setup', () => {
  it('opens one session in the working directory with the sandbox config', async () => {
    const { deps, client } = setup();

    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, { ...deps, client: client });

    expect(client.createSession).toHaveBeenCalledOnce();
    const [config] = client.configs;
    expect(config.workingDirectory).toBe(WORKING_DIRECTORY);
    expect(config.systemMessage.mode).toBe('append');
    expect(Object.keys(config.mcpServers)).toEqual(['atlassian', 'github_repos']);
    expect(config.availableTools).toHaveLength(9);
  });

  it('registers working hooks: a call outside the allowed repositories is denied', async () => {
    const { deps, client } = setup();
    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);
    const [{ hooks }] = client.configs;

    const decision = hooks.onPreToolUse({
      toolName: 'github_repos-get_file_contents',
      toolArgs: { owner: 'evil', repo: 'secrets' },
    });

    expect(decision.permissionDecision).toBe('deny');
  });

  it('gives the hooks the configured cloudId, so Confluence calls use it', async () => {
    const cloudId = '82b58a78-f056-49aa-a740-c3c946f68f8b';
    const { deps, client } = setup({ env: { ATLASSIAN_CLOUD_ID: cloudId } });
    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);
    const [{ hooks }] = client.configs;

    const decision = hooks.onPreToolUse({
      toolName: 'atlassian-searchConfluence',
      toolArgs: { cql: 'space = ENG AND text ~ "x"', cloudId: '<fill>' },
    });

    expect(decision.modifiedArgs).toMatchObject({ cloudId });
  });

  it('registers a working permission handler: a shell request is rejected', async () => {
    const { deps, client } = setup();
    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);
    const [{ onPermissionRequest }] = client.configs;

    const decision = onPermissionRequest({ kind: 'shell' }, { sessionId: 's' });

    expect(decision.kind).toBe('reject');
  });

  it('masks the Atlassian token in the error text of a failed tool call', async () => {
    const { deps, client, lines } = setup();
    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);
    const [{ hooks }] = client.configs;

    hooks.onPostToolUseFailure({
      toolName: 'atlassian-searchConfluence',
      toolArgs: {},
      error: `401 for ${FAKE_ATLASSIAN_TOKEN}`,
    });

    expect(lines().at(-1)).toMatchObject({ msg: 'tool call failed', error: '401 for ***' });
  });

  it('masks the encoded Basic credential, even without its prefix', async () => {
    const { deps, client, lines } = setup();
    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);
    const [{ hooks }] = client.configs;
    const encoded = encodeBasicCredentials('dev@acme.example', FAKE_ATLASSIAN_TOKEN);

    hooks.onPostToolUseFailure({
      toolName: 'atlassian-searchConfluence',
      toolArgs: {},
      error: `rejected ${encoded}`,
    });

    expect(JSON.stringify(lines())).not.toContain(encoded);
  });

  it('gives each question its own tool call budget', async () => {
    const { deps, client } = setup({ env: { MAX_TOOL_CALLS: '1' } });
    const call = {
      toolName: 'github_repos-list_commits',
      toolArgs: { owner: 'acme', repo: 'app' },
    };
    await askQuestion({ role: TEST_ROLE, question: 'First?' }, deps);
    await askQuestion({ role: TEST_ROLE, question: 'Second?' }, deps);
    const [first, second] = client.configs;

    first.hooks.onPreToolUse(call);
    const firstAgain = first.hooks.onPreToolUse(call);
    const secondFirst = second.hooks.onPreToolUse(call);

    expect(firstAgain.permissionDecision).toBe('deny');
    expect(secondFirst.permissionDecision).toBe('allow');
  });
});

describe('askQuestion failures', () => {
  it('throws a CopilotError naming the service error when the session reports one', async () => {
    const session = createFakeSession({
      script(emit) {
        emit('session.error', {
          errorType: 'rate_limit',
          message: 'Too many requests',
          statusCode: 429,
        });
      },
    });
    const { deps } = setup({ session });

    const failure = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.message).toBe('Copilot reported an error (rate_limit 429): Too many requests');
  });

  it('describes a service error that has no status code', async () => {
    const session = createFakeSession({
      script(emit) {
        emit('session.error', { errorType: 'unknown', message: 'Something broke' });
      },
    });
    const { deps } = setup({ session });

    await expect(askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps)).rejects.toThrow(
      'Copilot reported an error (unknown): Something broke',
    );
  });

  it('keeps the first outcome when an error is followed by idle', async () => {
    const session = createFakeSession({
      script(emit) {
        emit('session.error', { errorType: 'e', message: 'first' });
        emit('session.idle', {});
      },
    });
    const { deps } = setup({ session });

    await expect(askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps)).rejects.toThrow('first');
  });

  it('wraps a failure to send in a CopilotError with the cause', async () => {
    const cause = new Error('connection reset');
    const { deps } = setup({ session: createFakeSession({ sendError: cause }) });

    const failure = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.message).toBe('Copilot could not answer the question');
    expect(failure.cause).toBe(cause);
  });

  it('wraps a failure to create the session in a CopilotError with the cause', async () => {
    const cause = new Error('not authenticated');
    const { deps, session } = setup({ createFailure: cause });

    const failure = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.cause).toBe(cause);
    expect(session.disconnect).not.toHaveBeenCalled();
  });

  it('fails the question when the receiver of streamed text throws', async () => {
    const cause = new Error('stdout closed');
    const session = createFakeSession({
      script(emit) {
        emit('assistant.message_delta', { deltaContent: 'x' });
        emit('session.idle', {});
      },
    });
    const { deps } = setup({ session });

    const failure = await askQuestion(
      {
        question: 'Hi?',
        role: TEST_ROLE,
        onDelta: () => {
          throw cause;
        },
      },
      deps,
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure.message).toBe('Could not write the streamed answer');
    expect(failure.cause).toBe(cause);
  });

  it.each([
    ['a failure to send', { sendError: new Error('boom') }],
    [
      'a session error',
      {
        script: (/** @type {any} */ emit) =>
          emit('session.error', { errorType: 'e', message: 'm' }),
      },
    ],
  ])('still disconnects the session after %s', async (_name, behaviour) => {
    const session = createFakeSession(behaviour);
    const { deps } = setup({ session });

    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch(() => undefined);

    expect(session.disconnect).toHaveBeenCalledOnce();
  });
});

describe('askQuestion cleanup', () => {
  it('disconnects the session once, and stops listening, after a successful answer', async () => {
    const session = createFakeSession({ script: (emit) => emit('session.idle', {}) });
    const { deps } = setup({ session });
    const pieces = /** @type {string[]} */ ([]);

    await askQuestion(
      { role: TEST_ROLE, question: 'Hi?', onDelta: (text) => pieces.push(text) },
      deps,
    );
    session.emit('assistant.message_delta', { deltaContent: 'late' });

    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(session.listenerCount()).toBe(0);
    expect(pieces).toEqual([]);
  });

  it('logs and carries on when disconnecting fails, so the answer is still returned', async () => {
    const session = createFakeSession({
      script: (emit) => {
        emit('assistant.message', { content: clarifyReply('answer?') });
        emit('session.idle', {});
      },
      disconnectError: new Error('already closed'),
    });
    const { deps, lines } = setup({ session });

    const { answer } = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(answer).toBe('answer?');
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: 'could not disconnect the session' }),
    );
  });

  it('gives up waiting for a disconnect that never finishes instead of hanging', async () => {
    vi.useFakeTimers();
    const session = createFakeSession({
      script: (emit) => emit('session.idle', {}),
      hangOnDisconnect: true,
    });
    const { deps, lines } = setup({ session });

    const pending = askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);
    await vi.advanceTimersByTimeAsync(5000);
    await pending;

    expect(lines()).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: 'gave up waiting to disconnect the session' }),
    );
  });
});

describe('askQuestion timeout', () => {
  it('aborts and disconnects the session, then throws AskTimeoutError, when the time runs out', async () => {
    vi.useFakeTimers();
    const session = createFakeSession();
    const { deps } = setup({ session, env: { ASK_TIMEOUT_MS: '8000' } });

    const outcome = askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch((error) => error);
    await vi.advanceTimersByTimeAsync(8000);
    const failure = await outcome;

    expect(failure).toBeInstanceOf(AskTimeoutError);
    expect(failure.timeoutMs).toBe(8000);
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.disconnect).toHaveBeenCalledOnce();
  });

  it('does not time out before the limit', async () => {
    vi.useFakeTimers();
    const { deps } = setup({
      env: { ASK_TIMEOUT_MS: '8000' },
      session: createFakeSession(),
    });
    let settled = false;

    const outcome = askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps)
      .catch((error) => error)
      .then((value) => {
        settled = true;
        return value;
      });
    await vi.advanceTimersByTimeAsync(7999);

    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });

  it('times out even if the session cannot be created, with nothing to abort or disconnect', async () => {
    vi.useFakeTimers();
    const session = createFakeSession();
    const { deps } = setup({ session, env: { ASK_TIMEOUT_MS: '6000' } });
    deps.client = { createSession: () => new Promise(() => undefined) };

    const outcome = askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch((error) => error);
    await vi.advanceTimersByTimeAsync(6000);
    const failure = await outcome;

    expect(failure).toBeInstanceOf(AskTimeoutError);
    expect(session.abort).not.toHaveBeenCalled();
    expect(session.disconnect).not.toHaveBeenCalled();
  });

  it('still throws AskTimeoutError, and still disconnects, when the abort fails', async () => {
    vi.useFakeTimers();
    const session = createFakeSession({ abortError: new Error('abort failed') });
    const { deps, lines } = setup({ session, env: { ASK_TIMEOUT_MS: '5000' } });

    const outcome = askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch((error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    const failure = await outcome;

    expect(failure).toBeInstanceOf(AskTimeoutError);
    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: 'could not abort the timed-out question' }),
    );
  });

  it('leaves no timer running after a successful answer', async () => {
    vi.useFakeTimers();
    const session = createFakeSession({ script: (emit) => emit('session.idle', {}) });
    const { deps } = setup({ session });

    await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('askQuestion defaults', () => {
  it('uses the real clock when none is injected', async () => {
    const session = createFakeSession({ script: (emit) => emit('session.idle', {}) });
    const { deps } = setup({ session });
    const withoutClock = { ...deps, clock: undefined };

    const { durationMs } = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, withoutClock);

    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('wraps an unexpected error from the session in a CopilotError with the cause', async () => {
    const cause = new TypeError('unexpected');
    const session = createFakeSession();
    session.on.mockImplementation(() => {
      throw cause;
    });
    const { deps } = setup({ session });

    const failure = await askQuestion({ role: TEST_ROLE, question: 'Hi?' }, deps).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.cause).toBe(cause);
  });
});
