// @ts-check
import { describe, expect, it } from 'vitest';
import { createConversationRegistry } from '../../src/citations/index.js';
import { createConversation } from '../../src/conversation/index.js';
import { TEST_ROLE } from '../helpers/role.js';

/**
 * A conversation with a clock the test moves.
 * @param {Partial<{ maxTurns: number, maxSourceChars: number }>} [limits] - Limits to change.
 * @returns {{ conversation: import('../../src/conversation/index.js').Conversation, setNow: (ms: number) => void }} The conversation and the clock.
 */
function setup(limits = {}) {
  let now = 1000;
  const clock = { now: () => now };
  const conversation = createConversation({
    id: 'c-1',
    role: TEST_ROLE,
    registry: createConversationRegistry({ clock }),
    clock,
    limits: { maxTurns: 3, maxSourceChars: 100, ...limits },
  });
  return { conversation, setNow: (ms) => (now = ms) };
}

const ASK = { question: 'What is it?', detailLevel: /** @type {const} */ ('default') };

describe('a new conversation', () => {
  it('has its role, no turns, no session and nothing used', () => {
    const { conversation } = setup();

    expect(conversation).toMatchObject({
      id: 'c-1',
      role: TEST_ROLE,
      createdAt: 1000,
      maxTurns: 3,
    });
    expect(conversation.turns()).toEqual([]);
    expect(conversation.session()).toBeUndefined();
    expect(conversation.isBusy()).toBe(false);
    expect(conversation.sourceChars()).toBe(0);
    expect(conversation.fullReason()).toBeUndefined();
    expect(conversation.wasTruncated()).toBe(false);
    expect(conversation.endedReason()).toBeUndefined();
  });
});

describe('turns', () => {
  it('numbers turns from 1, records them, and sets the registry to the turn', () => {
    const { conversation, setNow } = setup();
    setNow(2000);

    const first = conversation.beginTurn(ASK);
    conversation.finishTurn(1, 'answered', { answerId: 'a1' });
    const second = conversation.beginTurn({ ...ASK, detailLevel: 'more' });

    expect(first).toEqual({ ok: true, turn: 1 });
    expect(second).toEqual({ ok: true, turn: 2 });
    expect(conversation.registry.turn()).toBe(2);
    expect(conversation.turnCount()).toBe(2);
    expect(conversation.turns()).toEqual([
      {
        turn: 1,
        question: 'What is it?',
        detailLevel: 'default',
        startedAt: 2000,
        status: 'answered',
        finishedAt: 2000,
        outcome: { answerId: 'a1' },
      },
      expect.objectContaining({ turn: 2, detailLevel: 'more', status: 'running' }),
    ]);
  });

  it('refuses a second turn while one is running', () => {
    const { conversation } = setup();
    conversation.beginTurn(ASK);

    expect(conversation.isBusy()).toBe(true);
    expect(conversation.beginTurn(ASK)).toEqual({ ok: false, refusal: 'busy' });
    expect(conversation.turnCount()).toBe(1);
  });

  it.each(['answered', 'cancelled', 'failed'])(
    'frees the conversation when a turn is %s',
    (status) => {
      const { conversation } = setup();
      conversation.beginTurn(ASK);

      conversation.finishTurn(1, /** @type {any} */ (status));

      expect(conversation.isBusy()).toBe(false);
      expect(conversation.turns()[0]?.status).toBe(status);
    },
  );

  it('counts a cancelled turn toward the cap, since it may have fetched sources', () => {
    const { conversation } = setup({ maxTurns: 1 });
    conversation.beginTurn(ASK);
    conversation.finishTurn(1, 'cancelled');

    expect(conversation.fullReason()).toBe('turns');
    expect(conversation.beginTurn(ASK)).toEqual({ ok: false, refusal: 'turns' });
  });

  it('ignores the end of a turn it never started', () => {
    const { conversation } = setup();

    conversation.finishTurn(7, 'answered');

    expect(conversation.turns()).toEqual([]);
  });

  it('hands out copies of its records', () => {
    const { conversation } = setup();
    conversation.beginTurn(ASK);

    conversation.turns()[0].question = 'changed';

    expect(conversation.turns()[0]?.question).toBe('What is it?');
  });
});

describe('annotating a turn', () => {
  it('adds to what the turn recorded, keeping the rest', () => {
    const { conversation } = setup();
    conversation.beginTurn(ASK);
    conversation.finishTurn(1, 'answered', { result: 'r' });

    conversation.annotateTurn(1, { answerId: 'a1' });

    expect(conversation.turns()[0]?.outcome).toEqual({ result: 'r', answerId: 'a1' });
  });

  it('ignores a turn that does not exist', () => {
    const { conversation } = setup();

    conversation.annotateTurn(3, { answerId: 'a1' });

    expect(conversation.turns()).toEqual([]);
  });
});

describe('the source budget', () => {
  it('adds up the source text given to the model', () => {
    const { conversation } = setup();

    conversation.addSourceChars(30);
    conversation.addSourceChars(20);

    expect(conversation.sourceChars()).toBe(50);
    expect(conversation.fullReason()).toBeUndefined();
  });

  it('refuses the next turn once the budget is used, but not before', () => {
    const { conversation } = setup({ maxSourceChars: 100 });
    conversation.addSourceChars(99);
    expect(conversation.beginTurn(ASK)).toEqual({ ok: true, turn: 1 });
    conversation.finishTurn(1, 'answered');

    conversation.addSourceChars(1);

    expect(conversation.fullReason()).toBe('budget');
    expect(conversation.beginTurn(ASK)).toEqual({ ok: false, refusal: 'budget' });
  });

  it('reports the turn cap before the budget when both are reached', () => {
    const { conversation } = setup({ maxTurns: 1, maxSourceChars: 10 });
    conversation.beginTurn(ASK);
    conversation.finishTurn(1, 'answered');
    conversation.addSourceChars(50);

    expect(conversation.fullReason()).toBe('turns');
  });
});

describe('activity', () => {
  it('moves the last activity on touch, on a new turn and on the end of a turn', () => {
    const { conversation, setNow } = setup();
    expect(conversation.lastActivityAt()).toBe(1000);

    setNow(2000);
    conversation.touch();
    expect(conversation.lastActivityAt()).toBe(2000);

    setNow(3000);
    conversation.beginTurn(ASK);
    expect(conversation.lastActivityAt()).toBe(3000);

    setNow(4000);
    conversation.finishTurn(1, 'answered');
    expect(conversation.lastActivityAt()).toBe(4000);
  });
});

describe('the session', () => {
  it('keeps the session and gives it up once', () => {
    const { conversation } = setup();
    const session = { id: 's' };

    conversation.setSession(session);

    expect(conversation.session()).toBe(session);
    expect(conversation.takeSession()).toBe(session);
    expect(conversation.session()).toBeUndefined();
    expect(conversation.takeSession()).toBeUndefined();
  });
});

describe('ending', () => {
  it('refuses new turns once ended, and keeps the first reason', () => {
    const { conversation } = setup();

    conversation.end('truncated');
    conversation.end('idle');

    expect(conversation.endedReason()).toBe('truncated');
    expect(conversation.beginTurn(ASK)).toEqual({ ok: false, refusal: 'ended' });
  });

  it('remembers that the runtime dropped part of the history', () => {
    const { conversation } = setup();

    conversation.markTruncated();

    expect(conversation.wasTruncated()).toBe(true);
  });
});
