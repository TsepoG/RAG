// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  AskTimeoutError,
  ConversationBusyError,
  ConversationEndedError,
  ConversationFullError,
  CopilotError,
  QuestionCancelledError,
} from '../../src/errors/index.js';
import { BUSINESS_ROLE, FILE, FOLDER, PAGE, reply, WINDOW } from '../helpers/ask.js';
import { createSwitchableRegistry } from '../../src/conversation/turn.js';
import { setupConversation } from '../helpers/conversation.js';

afterEach(() => {
  vi.useRealTimers();
});

const ANSWER = reply(`${WINDOW} [C1].`);
const WITH_CODE = `The \`refund()\` call decides the refund window for every order [C1].`;
const PLAIN = `${WINDOW} for every order we take [C1].`;
const FIRST = { tools: [PAGE], reply: ANSWER };
const READ_FILE = {
  toolName: 'github_repos-get_file_contents',
  toolArgs: { owner: 'acme', repo: 'app' },
};

/**
 * The keys of the sources an answer cites.
 * @param {{ sources: Array<{ key: string }> }} result - The result.
 * @returns {string[]} The keys.
 */
function keysOf(result) {
  return result.sources.map((source) => source.key);
}

/**
 * A model turn that asks the pre-tool hook about a tool several times, then answers.
 * @param {number} times - How many calls to attempt.
 * @param {string} text - The reply.
 * @param {string[]} decisions - Where to put what the hook decided each time.
 * @returns {{ script: (context: any) => Promise<void> }} The turn.
 */
function attempts(times, text, decisions) {
  return {
    async script({ emit, hooks }) {
      for (let call = 0; call < times; call += 1) {
        decisions.push((await hooks.onPreToolUse(READ_FILE)).permissionDecision);
      }
      emit('assistant.message', { content: text });
      emit('session.idle', {});
    },
  };
}

describe('the first turn', () => {
  it('opens one session for the conversation and sends the question alone', async () => {
    const { ask, session, client, conversation } = await setupConversation({ turns: [FIRST] });

    const result = await ask();

    expect(client.createSession).toHaveBeenCalledOnce();
    expect(session.sent).toEqual([{ prompt: 'How do refunds work?' }]);
    expect(conversation.session()).toBe(session);
    expect(result).toMatchObject({ turn: 1, status: 'answered', answer: `${WINDOW} [C1].` });
  });

  it('records the turn as answered, with its result', async () => {
    const { ask, conversation } = await setupConversation({ turns: [FIRST] });

    const { turn, ...result } = await ask();

    expect(turn).toBe(1);
    expect(conversation.turns()).toEqual([
      expect.objectContaining({ turn: 1, status: 'answered', outcome: { result } }),
    ]);
  });

  it('streams the reply and reports what it is doing', async () => {
    const { ask } = await setupConversation({
      turns: [
        {
          script: ({ emit }) => {
            emit('assistant.message_delta', { deltaContent: 'Refunds' });
            emit('assistant.message', { content: ANSWER });
            emit('session.idle', {});
          },
        },
      ],
    });
    const deltas = /** @type {string[]} */ ([]);
    const activities = /** @type {unknown[]} */ ([]);

    await ask({ onDelta: (text) => deltas.push(text), onActivity: (a) => activities.push(a) });

    expect(deltas).toEqual(['Refunds']);
    expect(activities).toContainEqual({ kind: 'checking' });
  });
});

describe('progress', () => {
  it('reports each tool the model uses', async () => {
    const { ask } = await setupConversation({
      turns: [
        {
          script: ({ emit }) => {
            emit('tool.execution_start', {
              toolCallId: 't1',
              mcpServerName: 'atlassian',
              mcpToolName: 'searchConfluence',
              toolName: 'atlassian-searchConfluence',
              arguments: {},
            });
            emit('tool.execution_complete', { toolCallId: 't1', success: true });
            emit('assistant.message', { content: ANSWER });
            emit('session.idle', {});
          },
        },
      ],
    });
    const activities = /** @type {unknown[]} */ ([]);

    await ask({ onActivity: (activity) => activities.push(activity) });

    expect(activities).toContainEqual({
      kind: 'tool',
      server: 'atlassian',
      tool: 'searchConfluence',
    });
  });
});

describe('createSwitchableRegistry', () => {
  /**
   * A registry that remembers what it was asked.
   * @param {string} name - Which registry.
   * @returns {import('../../src/citations/index.js').CitationRegistry & { seen: string[] }} The registry.
   */
  function recording(name) {
    const seen = /** @type {string[]} */ ([]);
    return {
      seen,
      register: () => (seen.push(`${name}:register`), name),
      get: () => (seen.push(`${name}:get`), undefined),
      list: () => (seen.push(`${name}:list`), []),
      addCandidate: () => void seen.push(`${name}:addCandidate`),
      candidates: () => (seen.push(`${name}:candidates`), []),
    };
  }

  it('sends every call to the registry it was last pointed at', () => {
    const first = recording('first');
    const second = recording('second');
    const { registry, use } = createSwitchableRegistry(first);
    const call = () => {
      registry.register(/** @type {never} */ ({}));
      registry.get('C1');
      registry.list();
      registry.addCandidate(/** @type {never} */ ({}));
      registry.candidates();
    };

    call();
    use(second);
    call();

    const names = ['register', 'get', 'list', 'addCandidate', 'candidates'];
    expect(first.seen).toEqual(names.map((name) => `first:${name}`));
    expect(second.seen).toEqual(names.map((name) => `second:${name}`));
  });
});

describe('later turns', () => {
  it('reuse the session and send the question after a short follow-up note', async () => {
    const { ask, session, client } = await setupConversation({ turns: [FIRST, ANSWER] });

    await ask();
    const second = await ask({ question: 'And for gift cards?' });

    expect(client.createSession).toHaveBeenCalledOnce();
    expect(session.sent[1].prompt).toMatch(/^Follow-up in the same conversation\./);
    expect(session.sent[1].prompt).toMatch(/\n\nQuestion: And for gift cards\?$/);
    expect(second.turn).toBe(2);
  });

  it('continue the keys, and cite an earlier turn’s key without fetching it again', async () => {
    const { ask } = await setupConversation({
      turns: [
        FIRST,
        { tools: [FILE], reply: reply(`The code agrees [G1]. ${WINDOW} [C1].`) },
        reply(`${WINDOW} [C1].`),
      ],
    });

    await ask();
    const second = await ask();
    const third = await ask();

    expect(keysOf(second)).toEqual(['C1', 'G1']);
    expect(third).toMatchObject({ status: 'answered', invalidKeys: [] });
    expect(keysOf(third)).toEqual(['C1']);
  });

  it('give each key to one source, numbering each kind on from the turns before', async () => {
    const { ask } = await setupConversation({
      turns: [
        { tools: [FILE], reply: reply(`The code agrees [G1].`) },
        { tools: [FOLDER], reply: reply(`The folder holds it [G2].`) },
      ],
    });

    await ask();
    const second = await ask();

    expect(keysOf(second)).toEqual(['G2']);
  });

  it('list as sources and as also consulted only what that turn used', async () => {
    const { ask } = await setupConversation({
      turns: [
        FIRST,
        { tools: [FILE], reply: reply(`The code does it [G1].`) },
        { tools: [FOLDER], reply: reply(`The folder holds it [G2].`) },
      ],
    });

    await ask();
    await ask();
    const third = await ask();

    expect(keysOf(third)).toEqual(['G2']);
    expect(third.alsoConsulted).toEqual([]);
    expect(third.uncitedSourceKeys).toEqual([]);
  });

  it('refuse a key that no turn ever fetched', async () => {
    const { ask } = await setupConversation({ turns: [FIRST, reply(`${WINDOW} [C9].`)] });

    await ask();
    const second = await ask();

    expect(second.invalidKeys).toEqual(['C9']);
    expect(second.sources).toEqual([]);
  });

  it('give the model the note for more detail, and answer at that level', async () => {
    const { ask, session } = await setupConversation({ turns: [FIRST, ANSWER] });

    await ask();
    const second = await ask({ detailLevel: 'more' });

    expect(session.sent[1].prompt).toContain('one step more technically than your last answer');
    expect(second.detailLevel).toBe('more');
  });

  it('name the changed sources in the note when asked to read them again', async () => {
    const { ask, session } = await setupConversation({ turns: [FIRST, ANSWER] });

    await ask();
    await ask({ changedKeys: ['C1'] });

    expect(session.sent[1].prompt).toContain('have changed since you read them: C1');
  });

  it('count the source text given to the model against the conversation', async () => {
    const { ask, conversation } = await setupConversation({ turns: [FIRST] });

    await ask();

    expect(conversation.sourceChars()).toBeGreaterThan(0);
  });
});

describe('what restarts each turn', () => {
  it('counts tool calls again, so every turn has the whole allowance', async () => {
    const first = /** @type {string[]} */ ([]);
    const second = /** @type {string[]} */ ([]);
    const { ask } = await setupConversation({
      env: { MAX_TOOL_CALLS: '2' },
      turns: [attempts(3, ANSWER, first), attempts(2, ANSWER, second)],
    });

    await ask();
    await ask();

    expect(first).toEqual(['allow', 'allow', 'deny']);
    expect(second).toEqual(['allow', 'allow']);
  });

  it('opens the tools again after a rewrite locked them', async () => {
    const decisions = /** @type {string[]} */ ([]);
    const { ask, session } = await setupConversation({
      role: BUSINESS_ROLE,
      turns: [
        { tools: [PAGE], reply: reply(WITH_CODE) },
        reply(PLAIN),
        attempts(1, reply(`${WINDOW} [C1].`), decisions),
      ],
    });

    await ask();
    await ask();

    expect(session.sent).toHaveLength(3);
    expect(decisions).toEqual(['allow']);
  });
});

describe('a rewrite or a repair of the report', () => {
  it('is not a turn of its own', async () => {
    const { ask, session, conversation } = await setupConversation({
      role: BUSINESS_ROLE,
      turns: [{ tools: [PAGE], reply: reply(WITH_CODE) }, reply(PLAIN)],
    });

    const result = await ask();

    expect(result).toMatchObject({ rewritten: true, turn: 1 });
    expect(session.sent).toHaveLength(2);
    expect(conversation.turnCount()).toBe(1);
  });

  it('asking again for the answer-meta block is not a turn of its own either', async () => {
    const { ask, session, conversation } = await setupConversation({
      turns: [{ tools: [PAGE], reply: reply(`${WINDOW} [C1].`, null) }, ANSWER],
    });

    const result = await ask();

    expect(result).toMatchObject({ metaRepaired: true, status: 'answered' });
    expect(session.sent).toHaveLength(2);
    expect(conversation.turnCount()).toBe(1);
  });

  it('is told to the next turn, so the model takes the rewritten answer as its answer', async () => {
    const { ask, session } = await setupConversation({
      role: BUSINESS_ROLE,
      turns: [{ tools: [PAGE], reply: reply(WITH_CODE) }, reply(PLAIN), ANSWER],
    });

    await ask();
    await ask();

    expect(session.sent[2].prompt).toContain(
      'Your previous answer was rewritten before the reader saw it. The rewritten version is your answer; the draft before it was discarded.',
    );
  });

  it('is not mentioned to the next turn when nothing was rewritten', async () => {
    const { ask, session } = await setupConversation({ turns: [FIRST, ANSWER] });

    await ask();
    await ask();

    expect(session.sent[1].prompt).not.toContain('rewritten');
  });
});

describe('a turn that cannot start', () => {
  it('refuses a blank question without using a turn', async () => {
    const { ask, conversation, client } = await setupConversation({ turns: [FIRST] });

    await expect(ask({ question: '   ' })).rejects.toThrow(new AppError('A question is required'));

    expect(conversation.turnCount()).toBe(0);
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it('is cancelled at once, using no turn, when the signal is already aborted', async () => {
    const { ask, conversation, client } = await setupConversation({ turns: [FIRST] });
    const controller = new AbortController();
    controller.abort();

    await expect(ask({ signal: controller.signal })).rejects.toBeInstanceOf(QuestionCancelledError);

    expect(conversation.turnCount()).toBe(0);
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it('is refused while the last question is still being answered', async () => {
    /** @type {() => void} */
    let finish = () => undefined;
    const { ask, conversation } = await setupConversation({
      turns: [
        {
          script: async ({ emit }) => {
            await new Promise((resolve) => {
              finish = () => resolve(undefined);
            });
            emit('assistant.message', { content: ANSWER });
            emit('session.idle', {});
          },
        },
      ],
    });

    const running = ask();
    await expect(ask()).rejects.toBeInstanceOf(ConversationBusyError);
    finish();
    await running;

    expect(conversation.turnCount()).toBe(1);
  });

  it('is refused once the conversation has used its turns', async () => {
    const { ask } = await setupConversation({ turns: [FIRST], limits: { maxTurns: 1 } });
    await ask();

    const failure = await ask().catch((error) => error);

    expect(failure).toBeInstanceOf(ConversationFullError);
    expect(failure).toMatchObject({ limit: 'turns', message: expect.stringContaining('is full') });
  });

  it('is refused once the conversation has been given all the source text it may have', async () => {
    const { ask } = await setupConversation({ turns: [FIRST], limits: { maxSourceChars: 1 } });
    await ask();

    const failure = await ask().catch((error) => error);

    expect(failure).toBeInstanceOf(ConversationFullError);
    expect(failure.limit).toBe('budget');
  });

  it('is refused when the conversation has ended', async () => {
    const { ask, conversation } = await setupConversation({ turns: [FIRST] });
    conversation.end('idle');

    await expect(ask()).rejects.toBeInstanceOf(ConversationEndedError);
  });
});

describe('stopping a turn', () => {
  it('aborts that turn only: the session stays open and the next turn works', async () => {
    const controller = new AbortController();
    const { ask, session, client, conversation, endConversation } = await setupConversation({
      turns: [{ script: () => controller.abort() }, FIRST],
    });

    const failure = await ask({ signal: controller.signal }).catch((error) => error);
    const next = await ask();

    expect(failure).toBeInstanceOf(QuestionCancelledError);
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(endConversation).not.toHaveBeenCalled();
    expect(conversation.endedReason()).toBeUndefined();
    expect(conversation.turns()[0]).toMatchObject({ turn: 1, status: 'cancelled' });
    expect(client.createSession).toHaveBeenCalledOnce();
    expect(next).toMatchObject({ turn: 2, status: 'answered' });
  });

  it('ends the turn, not the conversation, when the time runs out', async () => {
    vi.useFakeTimers();
    const { ask, session, conversation, endConversation } = await setupConversation({
      env: { ASK_TIMEOUT_MS: '8000' },
      turns: [{ script: () => undefined }, FIRST],
    });

    const outcome = ask().catch((error) => error);
    await vi.advanceTimersByTimeAsync(8000);
    const failure = await outcome;
    const next = await ask();

    expect(failure).toBeInstanceOf(AskTimeoutError);
    expect(session.abort).toHaveBeenCalledOnce();
    expect(endConversation).not.toHaveBeenCalled();
    expect(conversation.turns()[0]).toMatchObject({ status: 'failed' });
    expect(next).toMatchObject({ turn: 2, status: 'answered' });
  });

  it('ends the conversation when the session does not confirm it went quiet after the abort', async () => {
    vi.useFakeTimers();
    const { ask, endConversation, conversation, closeSession, session } = await setupConversation({
      env: { ASK_TIMEOUT_MS: '8000' },
      abortGoesQuiet: false,
      turns: [{ script: () => undefined }],
    });

    const outcome = ask().catch((error) => error);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(5000);
    const failure = await outcome;

    expect(failure).toBeInstanceOf(AskTimeoutError);
    expect(endConversation).toHaveBeenCalledWith(conversation, 'abort-unconfirmed');
    expect(closeSession).toHaveBeenCalledWith(session, { running: true });
    await expect(ask()).rejects.toBeInstanceOf(ConversationEndedError);
  });

  it('leaves the conversation alone when the time runs out before there is a session', async () => {
    vi.useFakeTimers();
    const { ask, client, endConversation, conversation } = await setupConversation({
      env: { ASK_TIMEOUT_MS: '8000' },
      turns: [FIRST],
    });
    client.createSession.mockImplementation(() => new Promise(() => undefined));

    const outcome = ask().catch((error) => error);
    await vi.advanceTimersByTimeAsync(8000);

    expect(await outcome).toBeInstanceOf(AskTimeoutError);
    expect(endConversation).not.toHaveBeenCalled();
    expect(conversation.turns()[0]).toMatchObject({ status: 'failed' });
  });
});

describe('a session that fails', () => {
  it('ends the conversation when Copilot reports an error', async () => {
    const { ask, endConversation, conversation, closeSession, session } = await setupConversation({
      turns: [
        {
          script: ({ emit }) =>
            emit('session.error', { errorType: 'rate_limit', message: 'slow down' }),
        },
      ],
    });

    const failure = await ask().catch((error) => error);

    expect(failure).toBeInstanceOf(CopilotError);
    expect(endConversation).toHaveBeenCalledWith(conversation, 'session-error');
    expect(closeSession).toHaveBeenCalledWith(session, { running: true });
    expect(conversation.turns()[0]).toMatchObject({ status: 'failed' });
    await expect(ask()).rejects.toBeInstanceOf(ConversationEndedError);
  });

  it('ends the conversation when the session cannot be opened', async () => {
    const { ask, endConversation, conversation } = await setupConversation({
      createFailure: new Error('no runtime'),
    });

    const failure = await ask().catch((error) => error);

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.cause).toEqual(new Error('no runtime'));
    expect(endConversation).toHaveBeenCalledWith(conversation, 'session-error');
  });
});

describe('a conversation whose history the runtime cut short', () => {
  it.each(['session.truncation', 'session.compaction_start'])(
    'caps the answer at medium and ends the conversation after the turn when %s fires',
    async (eventType) => {
      const { ask, conversation, endConversation } = await setupConversation({
        turns: [
          {
            tools: [PAGE],
            script: ({ emit }) => {
              emit(eventType, {});
              emit('assistant.message', { content: ANSWER });
              emit('session.idle', {});
            },
          },
        ],
      });

      const result = await ask();

      expect(result).toMatchObject({ turn: 1, status: 'answered', confidence: 'medium' });
      expect(result.confidenceReason).toContain(
        "Some earlier sources were dropped from the assistant's memory.",
      );
      expect(result.capsApplied).toContainEqual(
        expect.objectContaining({ code: 'memory-dropped' }),
      );
      expect(conversation.wasTruncated()).toBe(true);
      expect(conversation.endedReason()).toBe('truncated');
      expect(endConversation).toHaveBeenCalledWith(conversation, 'truncated');
      await expect(ask()).rejects.toBeInstanceOf(ConversationEndedError);
    },
  );

  it('leaves the conversation open when nothing was dropped', async () => {
    const { ask, conversation } = await setupConversation({ turns: [FIRST] });

    const result = await ask();

    expect(result.confidence).toBe('high');
    expect(conversation.wasTruncated()).toBe(false);
    expect(conversation.endedReason()).toBeUndefined();
  });

  it('logs how full the context is, as numbers only', async () => {
    const { ask, lines } = await setupConversation({
      turns: [
        {
          script: ({ emit }) => {
            emit('session.usage_info', { currentTokens: 100, tokenLimit: 1000 });
            emit('assistant.message', { content: ANSWER });
            emit('session.idle', {});
          },
        },
      ],
    });

    await ask();

    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'context usage', currentTokens: 100, tokenLimit: 1000 }),
    );
  });
});

describe('after a turn', () => {
  it('stops listening to the session, so the next turn does not hear this one', async () => {
    const { ask, session } = await setupConversation({ turns: [FIRST] });

    await ask();

    expect(session.listenerCount()).toBe(0);
  });
});
