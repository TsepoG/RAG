// @ts-check
import { describe, expect, it } from 'vitest';
import { INITIAL_CHAT, next } from '../../../public/js/chatState.js';
import { describeSteps } from '../../../public/js/steps.js';
import { makeAnswer, makeConversation } from '../../helpers/page.js';

/**
 * Plays actions through the reducer.
 * @param {import('../../../public/js/chatState.js').ChatAction[]} actions - What happened, in order.
 * @param {import('../../../public/js/chatState.js').ChatState} [from] - Where to start.
 * @returns {import('../../../public/js/chatState.js').ChatState} The state after them.
 */
function play(actions, from = INITIAL_CHAT) {
  return actions.reduce(next, from);
}

const ASK = /** @type {const} */ ({ type: 'ask', question: 'How?', detailLevel: 'default' });

/**
 * The newest turn of a state.
 * @param {import('../../../public/js/chatState.js').ChatState} state - The state.
 * @returns {import('../../../public/js/chatState.js').TurnView} The turn.
 */
function newest(state) {
  return /** @type {any} */ (state.turns.at(-1));
}

describe('the steps of a running question', () => {
  it('starts with no steps and none in progress', () => {
    const turn = newest(play([ASK]));

    expect(turn.steps).toEqual([]);
    expect(turn.currentStep).toBe('');
  });

  it('records each progress line as a step, in the order they came', () => {
    const turn = newest(
      play([
        ASK,
        { type: 'progress', message: 'Searching Confluence…' },
        { type: 'progress', message: 'Opening a Confluence page…' },
      ]),
    );

    expect(turn.steps.map(({ id }) => id)).toEqual(['confluence-search', 'confluence-read']);
    expect(turn).not.toHaveProperty('progress');
    expect(turn.currentStep).toBe('confluence-read');
    expect(describeSteps(turn).map(({ status }) => status)).toEqual(['done', 'current', 'future']);
  });

  it('counts a repeated step instead of adding a row', () => {
    const turn = newest(
      play([
        ASK,
        { type: 'progress', message: 'Opening a Confluence page…' },
        { type: 'progress', message: 'Opening a Confluence page…' },
      ]),
    );

    expect(turn.steps).toEqual([{ id: 'confluence-read', count: 2, detail: '' }]);
  });

  it('makes writing the step in progress from the first token, and the draft grows', () => {
    const turn = newest(
      play([
        ASK,
        { type: 'progress', message: 'Searching the code…' },
        { type: 'token', text: 'The ' },
        { type: 'token', text: 'order' },
      ]),
    );

    expect(turn.draft).toBe('The order');
    expect(turn.currentStep).toBe('writing');
    expect(turn.steps.map(({ id }) => id)).toEqual(['code-search', 'writing']);
  });

  it('clears the steps when the answer arrives', () => {
    const turn = newest(
      play([
        ASK,
        { type: 'progress', message: 'Searching the code…' },
        { type: 'done', payload: makeAnswer({ turn: 1 }) },
      ]),
    );

    expect(turn.steps).toEqual([]);
    expect(turn.currentStep).toBe('');
    expect(turn.phase).toBe('answered');
  });

  it.each([
    ['stop', { type: 'stop' }],
    ['a failure', { type: 'error', kind: 'timeout', message: 'Too slow.' }],
    ['a stream that ends early', { type: 'ended' }],
  ])('clears the steps on %s', (_name, action) => {
    const turn = newest(
      play([
        ASK,
        { type: 'progress', message: 'Searching the code…' },
        /** @type {import('../../../public/js/chatState.js').ChatAction} */ (action),
      ]),
    );

    expect(turn.steps).toEqual([]);
    expect(turn.currentStep).toBe('');
  });

  it('does not record a progress line that arrives when nothing is running', () => {
    const state = play([{ type: 'progress', message: 'Searching the code…' }]);

    expect(state).toBe(INITIAL_CHAT);
  });

  it('gives a turn read back from the server no steps', () => {
    const state = play([
      {
        type: 'restored',
        roleDepth: 2,
        transcript: {
          ...makeConversation(),
          turns: [
            { turn: 1, question: 'How?', detailLevel: 'default', status: 'answered', answer: null },
          ],
        },
      },
    ]);

    expect(newest(state).steps).toEqual([]);
    expect(newest(state).currentStep).toBe('');
  });
});
