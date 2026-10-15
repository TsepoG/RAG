// @ts-check
import { describe, expect, it } from 'vitest';
import {
  canAsk,
  canReask,
  canShowMoreDetail,
  CONVERSATION_GONE,
  conversationFromTranscript,
  fromServerEvent,
  INITIAL_CHAT,
  isBusy,
  next,
} from '../../../public/js/chatState.js';
import { makeAnswer, makeConversation } from '../../helpers/page.js';

/**
 * Applies actions one after another.
 * @param {import('../../../public/js/chatState.js').ChatState} state - Where to start.
 * @param {import('../../../public/js/chatState.js').ChatAction[]} actions - What happens.
 * @returns {import('../../../public/js/chatState.js').ChatState} The state at the end.
 */
function run(state, actions) {
  return actions.reduce(next, state);
}

const STARTED = /** @type {const} */ ({
  type: 'started',
  conversation: makeConversation({ turnCount: 0 }),
});
const ASK = /** @type {const} */ ({ type: 'ask', question: 'How?', detailLevel: 'default' });
const DONE = (/** @type {Record<string, any>} */ changes = {}) =>
  /** @type {const} */ ({
    type: 'done',
    payload: { ...makeAnswer(changes), conversation: makeConversation({ turnCount: 1 }) },
  });

describe('the first question', () => {
  it('starts with nothing: no conversation, no turns, free to ask', () => {
    expect(INITIAL_CHAT.conversation).toBeUndefined();
    expect(INITIAL_CHAT.turns).toEqual([]);
    expect(canAsk(INITIAL_CHAT)).toBe(true);
    expect(isBusy(INITIAL_CHAT)).toBe(false);
  });

  it('adds a running turn, numbered after the ones already used', () => {
    const state = run(INITIAL_CHAT, [STARTED, ASK]);

    expect(state.turns).toEqual([
      expect.objectContaining({ turn: 1, question: 'How?', phase: 'running', draft: '' }),
    ]);
    expect(isBusy(state)).toBe(true);
    expect(canAsk(state)).toBe(false);
  });

  it('does not start a second question while one is running', () => {
    const running = run(INITIAL_CHAT, [STARTED, ASK]);

    expect(next(running, { ...ASK, question: 'Again?' })).toBe(running);
  });
});

describe('while a question runs', () => {
  it('shows progress and builds the draft from the tokens', () => {
    const state = run(INITIAL_CHAT, [
      STARTED,
      ASK,
      { type: 'progress', message: 'Searching…' },
      { type: 'token', text: 'Re' },
      { type: 'token', text: 'funds' },
    ]);

    expect(state.turns[0]).toMatchObject({ progress: 'Searching…', draft: 'Refunds' });
  });

  it('turns into the answer on done, takes the turn from the server and learns where the conversation stands', () => {
    const state = run(INITIAL_CHAT, [STARTED, ASK, { type: 'token', text: 'x' }, DONE()]);

    expect(state.turns[0]).toMatchObject({ phase: 'answered', turn: 1, progress: '' });
    expect(state.turns[0]?.answer?.answerId).toBe('a1');
    expect(state.turns[0]?.answer).not.toHaveProperty('conversation');
    expect(state.conversation).toMatchObject({ turnCount: 1, roleDepth: 1 });
    expect(isBusy(state)).toBe(false);
  });

  it('is stopped by Stop, keeping the draft', () => {
    const state = run(INITIAL_CHAT, [
      STARTED,
      ASK,
      { type: 'token', text: 'half' },
      { type: 'stop' },
    ]);

    expect(state.turns[0]).toMatchObject({ phase: 'stopped', draft: 'half' });
    expect(canAsk(state)).toBe(true);
  });

  it('counts a cancelled error from the server as stopped, and any other error as failed', () => {
    const cancelled = run(INITIAL_CHAT, [
      STARTED,
      ASK,
      { type: 'error', kind: 'cancelled', message: 'The question was stopped.' },
    ]);
    const failed = run(INITIAL_CHAT, [
      STARTED,
      ASK,
      {
        type: 'error',
        kind: 'copilot',
        message: 'Copilot could not answer just now.',
        conversation: makeConversation({ turnCount: 1, ended: 'session-error' }),
      },
    ]);

    expect(cancelled.turns[0]).toMatchObject({ phase: 'stopped', failure: undefined });
    expect(failed.turns[0]).toMatchObject({
      phase: 'failed',
      failure: 'Copilot could not answer just now.',
    });
    expect(failed.conversation?.ended).toBe('session-error');
    expect(canAsk(failed)).toBe(false);
  });

  it('fails a question whose stream closed before it was answered', () => {
    const state = run(INITIAL_CHAT, [STARTED, ASK, { type: 'ended' }]);

    expect(state.turns[0]?.failure).toContain('connection closed');
  });

  it('ignores progress, tokens and the end of a stream when nothing is running', () => {
    const answered = run(INITIAL_CHAT, [STARTED, ASK, DONE()]);

    for (const action of /** @type {const} */ ([
      { type: 'progress', message: 'late' },
      { type: 'token', text: 'late' },
      { type: 'stop' },
      { type: 'ended' },
      { type: 'error', kind: 'copilot', message: 'late' },
      DONE(),
    ])) {
      expect(next(answered, action)).toBe(answered);
    }
  });

  it('ignores an action it does not know', () => {
    const running = run(INITIAL_CHAT, [STARTED, ASK]);

    expect(next(running, /** @type {any} */ ({ type: 'nonsense' }))).toBe(running);
  });
});

describe('after an answer', () => {
  const answered = run(INITIAL_CHAT, [STARTED, ASK, DONE()]);
  const [turn] = answered.turns;

  it('offers more detail on the newest answered turn only, for a role not already at the most technical depth', () => {
    expect(canShowMoreDetail(answered, /** @type {any} */ (turn))).toBe(true);

    const technical = run(answered, [
      { type: 'conversationState', conversation: makeConversation({ roleDepth: 3 }) },
    ]);
    expect(canShowMoreDetail(technical, /** @type {any} */ (technical.turns[0]))).toBe(false);

    const second = run(answered, [{ ...ASK, question: 'And?' }]);
    expect(canShowMoreDetail(second, /** @type {any} */ (second.turns[0]))).toBe(false);
  });

  it('does not offer more detail when there is no conversation to know the role from', () => {
    const lost = { ...answered, conversation: undefined };

    expect(canShowMoreDetail(lost, /** @type {any} */ (lost.turns[0]))).toBe(false);
  });

  it('does not offer more detail on an answer that was already more detailed, or was not an answer', () => {
    const more = run(INITIAL_CHAT, [STARTED, { ...ASK, detailLevel: 'more' }, DONE()]);
    const unsure = run(INITIAL_CHAT, [STARTED, ASK, DONE({ result: { status: 'not_found' } })]);

    expect(canShowMoreDetail(more, /** @type {any} */ (more.turns[0]))).toBe(false);
    expect(canShowMoreDetail(unsure, /** @type {any} */ (unsure.turns[0]))).toBe(false);
  });

  it('offers a re-ask only when a cited source has changed', () => {
    const changed = run(INITIAL_CHAT, [STARTED, ASK, DONE({ changedKeys: ['C1'] })]);

    expect(canReask(answered, /** @type {any} */ (turn))).toBe(false);
    expect(canReask(changed, /** @type {any} */ (changed.turns[0]))).toBe(true);
  });

  it('offers neither when the conversation is full or has ended', () => {
    const full = run(INITIAL_CHAT, [
      STARTED,
      ASK,
      DONE({ changedKeys: ['C1'] }),
      {
        type: 'conversationState',
        conversation: makeConversation({ full: 'turns', fullMessage: 'full' }),
      },
    ]);

    expect(canAsk(full)).toBe(false);
    expect(canReask(full, /** @type {any} */ (full.turns[0]))).toBe(false);
    expect(canShowMoreDetail(full, /** @type {any} */ (full.turns[0]))).toBe(false);
  });
});

describe('re-checks', () => {
  it('replaces the answers the server rebuilt and learns where the conversation stands', () => {
    const asked = run(INITIAL_CHAT, [STARTED, ASK, DONE()]);
    const rebuilt = makeAnswer({ changedKeys: ['C1'], result: { confidence: 'medium' } });

    const state = next(asked, {
      type: 'recheck',
      payload: {
        updates: [rebuilt, makeAnswer({ answerId: 'other' })],
        conversation: makeConversation({ turnCount: 2 }),
      },
    });

    expect(state.turns[0]?.answer).toBe(rebuilt);
    expect(state.conversation?.turnCount).toBe(2);
  });

  it('leaves an answer alone that the re-check did not touch, and a turn with no answer', () => {
    const state = run(INITIAL_CHAT, [STARTED, ASK, DONE(), { ...ASK, question: 'Next' }]);

    const after = next(state, {
      type: 'recheck',
      payload: { updates: [makeAnswer({ answerId: 'x' })] },
    });

    expect(after.turns).toEqual(state.turns);
    expect(after.conversation).toBe(state.conversation);
  });

  it('keeps a list of the answers being checked by hand', () => {
    const on = run(INITIAL_CHAT, [
      { type: 'checking', answerId: 'a1', on: true },
      { type: 'checking', answerId: 'a1', on: true },
      { type: 'checking', answerId: 'a2', on: true },
    ]);
    const off = next(on, { type: 'checking', answerId: 'a1', on: false });

    expect(on.checking).toEqual(['a1', 'a2']);
    expect(off.checking).toEqual(['a2']);
  });
});

describe('feedback', () => {
  it('records a thumb, then whether it was saved', () => {
    const rated = next(INITIAL_CHAT, { type: 'rate', answerId: 'a1', rating: 'down' });
    const saved = next(rated, {
      type: 'rated',
      answerId: 'a1',
      saved: true,
      message: 'Thank you.',
    });

    expect(rated.ratings.a1).toEqual({ rating: 'down', saved: false, message: '' });
    expect(saved.ratings.a1).toEqual({ rating: 'down', saved: true, message: 'Thank you.' });
  });

  it('ignores the result for an answer nobody rated', () => {
    expect(next(INITIAL_CHAT, { type: 'rated', answerId: 'zz', saved: true, message: 'x' })).toBe(
      INITIAL_CHAT,
    );
  });
});

describe('the rest of the conversation', () => {
  it('restores a transcript: the answered turns, and what became of the others', () => {
    const transcript = {
      ...makeConversation({ turnCount: 3 }),
      turns: [
        {
          turn: 1,
          question: 'One',
          detailLevel: 'default',
          status: 'answered',
          answer: makeAnswer(),
        },
        { turn: 2, question: 'Two', detailLevel: 'default', status: 'cancelled', answer: null },
        { turn: 3, question: 'Three', detailLevel: 'more', status: 'failed', answer: null },
      ],
    };

    const state = next(INITIAL_CHAT, {
      type: 'restored',
      transcript: /** @type {any} */ (transcript),
      roleDepth: 2,
    });

    expect(state.turns.map(({ phase }) => phase)).toEqual(['answered', 'stopped', 'failed']);
    expect(state.turns[2]).toMatchObject({ detailLevel: 'more', failure: expect.any(String) });
    expect(state.conversation).toEqual({
      ...conversationFromTranscript(/** @type {any} */ (transcript)),
      roleDepth: 2,
    });
    expect(state.conversation).not.toHaveProperty('turns');
  });

  it('says the conversation has ended when the server no longer has it, keeping what is shown', () => {
    const asked = run(INITIAL_CHAT, [STARTED, ASK, DONE()]);

    const gone = next(asked, { type: 'gone' });

    expect(gone.notice).toBe(CONVERSATION_GONE);
    expect(gone.conversation?.ended).toBe('gone');
    expect(gone.turns).toBe(asked.turns);
    expect(canAsk(gone)).toBe(false);
  });

  it('says it too when there never was a conversation', () => {
    expect(next(INITIAL_CHAT, { type: 'gone' })).toMatchObject({
      conversation: undefined,
      notice: CONVERSATION_GONE,
    });
  });

  it('shows a notice, and clears it when a question is asked', () => {
    const noticed = next(INITIAL_CHAT, { type: 'notice', text: 'Careful.' });

    expect(noticed.notice).toBe('Careful.');
    expect(next(noticed, ASK).notice).toBe('');
  });

  it('starts over on reset', () => {
    const asked = run(INITIAL_CHAT, [STARTED, ASK, DONE()]);

    expect(next(asked, { type: 'reset' })).toBe(INITIAL_CHAT);
  });

  it('numbers the first turn from the turns it has when it has no conversation yet', () => {
    expect(next(INITIAL_CHAT, ASK).turns[0]?.turn).toBe(1);
  });
});

describe('fromServerEvent', () => {
  it.each([
    [
      { event: 'progress', data: { message: 'Looking…' } },
      { type: 'progress', message: 'Looking…' },
    ],
    [
      { event: 'token', data: { text: 'Hi' } },
      { type: 'token', text: 'Hi' },
    ],
    [
      { event: 'progress', data: {} },
      { type: 'progress', message: '' },
    ],
    [
      { event: 'token', data: null },
      { type: 'token', text: '' },
    ],
  ])('turns %j into an action', (message, action) => {
    expect(fromServerEvent(message)).toEqual(action);
  });

  it('passes done and recheck payloads on whole', () => {
    const payload = { answerId: 'a1' };

    expect(fromServerEvent({ event: 'done', data: payload })).toEqual({ type: 'done', payload });
    expect(fromServerEvent({ event: 'recheck', data: payload })).toEqual({
      type: 'recheck',
      payload,
    });
  });

  it('reads an error with its kind and where the conversation stands', () => {
    const conversation = makeConversation();

    expect(
      fromServerEvent({
        event: 'error',
        data: { kind: 'timeout', message: 'Too slow.', conversation },
      }),
    ).toEqual({ type: 'error', kind: 'timeout', message: 'Too slow.', conversation });
    expect(fromServerEvent({ event: 'error', data: { message: 'x', conversation: 5 } })).toEqual({
      type: 'error',
      kind: 'internal',
      message: 'x',
      conversation: undefined,
    });
  });

  it('reads an error whose data is not an object', () => {
    expect(fromServerEvent({ event: 'error', data: null })).toEqual({
      type: 'error',
      kind: 'internal',
      message: '',
      conversation: undefined,
    });
  });

  it('gives nothing for an event it does not know', () => {
    expect(fromServerEvent({ event: 'surprise', data: {} })).toBeUndefined();
  });
});
