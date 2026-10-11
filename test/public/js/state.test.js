// @ts-check
import { describe, expect, it } from 'vitest';
import {
  canShowMoreDetail,
  fromServerEvent,
  INITIAL_STATE,
  isBusy,
  next,
} from '../../../public/js/state.js';

const ASK = /** @type {const} */ ({
  type: 'ask',
  question: 'How do refunds work?',
  role: 'product_owner',
  roleDepth: 1,
  detailLevel: 'default',
});

/**
 * Applies actions in order.
 * @param {import('../../../public/js/state.js').PageAction[]} actions - What happened.
 * @returns {import('../../../public/js/state.js').PageState} The state at the end.
 */
function run(actions) {
  return actions.reduce(
    next,
    /** @type {import('../../../public/js/state.js').PageState} */ (INITIAL_STATE),
  );
}

const DONE = {
  type: /** @type {const} */ ('done'),
  payload: /** @type {any} */ ({
    answerId: 'a1',
    result: { status: 'answered', detailLevel: 'default' },
  }),
};

describe('next: a question that works', () => {
  it('starts idle', () => {
    expect(INITIAL_STATE.phase).toBe('idle');
    expect(isBusy(INITIAL_STATE)).toBe(false);
  });

  it('moves to asking, and remembers what was asked', () => {
    expect(run([ASK])).toMatchObject({
      phase: 'asking',
      question: 'How do refunds work?',
      role: 'product_owner',
      roleDepth: 1,
      detailLevel: 'default',
    });
  });

  it('shows the latest progress line and stays asking until text arrives', () => {
    const state = run([
      ASK,
      { type: 'progress', message: 'a' },
      { type: 'progress', message: 'b' },
    ]);

    expect(state.phase).toBe('asking');
    expect(state.progress).toBe('b');
  });

  it('streams once the first token arrives, and builds the draft in order', () => {
    const state = run([ASK, { type: 'token', text: 'Refunds ' }, { type: 'token', text: 'work.' }]);

    expect(state.phase).toBe('streaming');
    expect(state.draft).toBe('Refunds work.');
  });

  it('finishes with the payload, and clears the progress line', () => {
    const state = run([
      ASK,
      { type: 'progress', message: 'a' },
      { type: 'token', text: 'x' },
      DONE,
    ]);

    expect(state.phase).toBe('done');
    expect(state.progress).toBe('');
    expect(state.answer).toBe(DONE.payload);
    expect(isBusy(state)).toBe(false);
  });

  it('is busy while asking and streaming', () => {
    expect(isBusy(run([ASK]))).toBe(true);
    expect(isBusy(run([ASK, { type: 'token', text: 'x' }]))).toBe(true);
  });
});

describe('next: a question that does not work', () => {
  it('shows what the server said when it reports an error', () => {
    const state = run([ASK, { type: 'error', kind: 'timeout', message: 'Too slow.' }]);

    expect(state).toMatchObject({
      phase: 'error',
      failure: { kind: 'timeout', message: 'Too slow.' },
    });
  });

  it('keeps the partial draft when it fails', () => {
    const state = run([
      ASK,
      { type: 'token', text: 'half' },
      { type: 'error', kind: 'copilot', message: 'm' },
    ]);

    expect(state.draft).toBe('half');
  });

  it('treats a cancelled error from the server as stopped, not as a failure', () => {
    const state = run([ASK, { type: 'error', kind: 'cancelled', message: 'Stopped.' }]);

    expect(state.phase).toBe('stopped');
    expect(state.failure).toBeUndefined();
  });

  it('stops when the person presses Stop, keeping the draft', () => {
    const state = run([ASK, { type: 'token', text: 'half' }, { type: 'stop' }]);

    expect(state).toMatchObject({ phase: 'stopped', draft: 'half', progress: '' });
  });

  it('reports a lost connection when the stream ends before an answer', () => {
    const state = run([ASK, { type: 'token', text: 'x' }, { type: 'ended' }]);

    expect(state.phase).toBe('error');
    expect(state.failure?.kind).toBe('connection');
  });

  it('does not mind the stream ending after the answer', () => {
    expect(run([ASK, DONE, { type: 'ended' }]).phase).toBe('done');
  });
});

describe('next: events that no longer matter', () => {
  it.each([
    ['a token', { type: 'token', text: 'late' }],
    ['a progress line', { type: 'progress', message: 'late' }],
    ['a done', DONE],
    ['an error', { type: 'error', kind: 'internal', message: 'late' }],
    ['the end of the stream', { type: 'ended' }],
    ['another stop', { type: 'stop' }],
  ])('change nothing after Stop: %s', (_name, late) => {
    const stopped = run([ASK, { type: 'token', text: 'x' }, { type: 'stop' }]);

    expect(next(stopped, /** @type {any} */ (late))).toBe(stopped);
  });

  it('ignores a token, a stop or a done when nothing is being asked', () => {
    expect(next(INITIAL_STATE, { type: 'token', text: 'x' })).toBe(INITIAL_STATE);
    expect(next(INITIAL_STATE, { type: 'stop' })).toBe(INITIAL_STATE);
    expect(next(INITIAL_STATE, DONE)).toBe(INITIAL_STATE);
  });

  it('ignores an unknown action while a question is running', () => {
    const busy = run([ASK]);

    expect(next(busy, /** @type {any} */ ({ type: 'nope' }))).toBe(busy);
  });

  it('ignores a second ask while one is running', () => {
    const busy = run([ASK, { type: 'token', text: 'x' }]);

    expect(next(busy, { ...ASK, question: 'another' })).toBe(busy);
  });

  it('ignores an unknown action', () => {
    expect(next(INITIAL_STATE, /** @type {any} */ ({ type: 'nope' }))).toBe(INITIAL_STATE);
  });
});

describe('next: asking again', () => {
  it.each([
    ['an answer', [ASK, DONE]],
    ['a failure', [ASK, { type: 'error', kind: 'internal', message: 'm' }]],
    ['a stop', [ASK, { type: 'stop' }]],
  ])('starts afresh after %s, with nothing left over', (_name, before) => {
    const state = run([
      .../** @type {any[]} */ (before),
      { ...ASK, question: 'second', detailLevel: 'more' },
    ]);

    expect(state).toMatchObject({
      phase: 'asking',
      question: 'second',
      detailLevel: 'more',
      draft: '',
      progress: '',
      answer: undefined,
      failure: undefined,
    });
  });

  it('goes back to idle on reset, unless a question is running', () => {
    expect(run([ASK, DONE, { type: 'reset' }])).toEqual(INITIAL_STATE);
    const busy = run([ASK]);
    expect(next(busy, { type: 'reset' })).toBe(busy);
  });
});

describe('fromServerEvent', () => {
  it.each([
    [
      { event: 'progress', data: { message: 'a' } },
      { type: 'progress', message: 'a' },
    ],
    [
      { event: 'token', data: { text: 'b' } },
      { type: 'token', text: 'b' },
    ],
    [
      { event: 'done', data: { answerId: '1' } },
      { type: 'done', payload: { answerId: '1' } },
    ],
    [
      { event: 'error', data: { kind: 'timeout', message: 'm' } },
      { type: 'error', kind: 'timeout', message: 'm' },
    ],
  ])('turns %j into an action', (message, action) => {
    expect(fromServerEvent(message)).toEqual(action);
  });

  it('copes with data that is missing parts', () => {
    expect(fromServerEvent({ event: 'token', data: {} })).toEqual({ type: 'token', text: '' });
    expect(fromServerEvent({ event: 'progress', data: null })).toEqual({
      type: 'progress',
      message: '',
    });
    expect(fromServerEvent({ event: 'error', data: undefined })).toEqual({
      type: 'error',
      kind: 'internal',
      message: '',
    });
  });

  it('gives nothing for an event it does not know', () => {
    expect(fromServerEvent({ event: 'ping', data: {} })).toBeUndefined();
  });
});

describe('canShowMoreDetail', () => {
  /**
   * A finished state.
   * @param {{ roleDepth?: number, status?: string, detailLevel?: 'default' | 'more', phase?: 'done' | 'stopped' }} [options] - What differs.
   * @returns {import('../../../public/js/state.js').PageState} The state.
   */
  function finished({
    roleDepth = 1,
    status = 'answered',
    detailLevel = 'default',
    phase = 'done',
  } = {}) {
    return {
      ...INITIAL_STATE,
      phase,
      roleDepth,
      detailLevel,
      answer: /** @type {any} */ ({ result: { status } }),
    };
  }

  it('is offered for an answered question at the usual level for a less technical role', () => {
    expect(canShowMoreDetail(finished())).toBe(true);
    expect(canShowMoreDetail(finished({ roleDepth: 2 }))).toBe(true);
  });

  it('is not offered for the most technical role', () => {
    expect(canShowMoreDetail(finished({ roleDepth: 3 }))).toBe(false);
  });

  it('is not offered when the answer already has more detail', () => {
    expect(canShowMoreDetail(finished({ detailLevel: 'more' }))).toBe(false);
  });

  it.each(['not_found', 'clarify', 'out_of_scope'])('is not offered for %s', (status) => {
    expect(canShowMoreDetail(finished({ status }))).toBe(false);
  });

  it('is not offered before there is an answer', () => {
    expect(canShowMoreDetail(INITIAL_STATE)).toBe(false);
    expect(canShowMoreDetail(finished({ phase: 'stopped' }))).toBe(false);
    expect(canShowMoreDetail({ ...INITIAL_STATE, phase: 'done' })).toBe(false);
  });
});
