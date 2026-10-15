// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_CHAT, next } from '../../../public/js/chatState.js';
import { drawTurns } from '../../../public/js/turnList.js';
import { FETCHED_AT, makeAnswer, makeConversation } from '../../helpers/page.js';

/** @type {HTMLOListElement} */
let list;
/** @type {WeakMap<HTMLElement, any>} */
let memory;
/** @type {Set<string>} */
let open;

beforeEach(() => {
  document.body.innerHTML = '<ol id="list"></ol>';
  list = /** @type {HTMLOListElement} */ (document.querySelector('#list'));
  memory = new WeakMap();
  open = new Set();
});

/**
 * Applies actions to a state.
 * @param {import('../../../public/js/chatState.js').ChatAction[]} actions - What happens.
 * @param {import('../../../public/js/chatState.js').ChatState} [from] - Where to start.
 * @returns {import('../../../public/js/chatState.js').ChatState} The state.
 */
function build(actions, from = INITIAL_CHAT) {
  return actions.reduce(next, from);
}

/**
 * Draws a state.
 * @param {import('../../../public/js/chatState.js').ChatState} state - The state.
 */
function draw(state) {
  drawTurns(list, memory, state, { now: FETCHED_AT, openSources: open });
}

const STARTED = /** @type {const} */ ({
  type: 'started',
  conversation: makeConversation({ turnCount: 0 }),
});
const ASK = (/** @type {string} */ question) =>
  /** @type {const} */ ({ type: 'ask', question, detailLevel: 'default' });
const DONE = (/** @type {Record<string, any>} */ changes = {}) =>
  /** @type {const} */ ({
    type: 'done',
    payload: { ...makeAnswer(changes), conversation: makeConversation() },
  });

describe('drawing turns', () => {
  it('shows the question as text, never as HTML', () => {
    draw(build([STARTED, ASK('<b>bold</b> question')]));

    expect(list.querySelector('.bubble.user .text')?.textContent).toBe('<b>bold</b> question');
    expect(list.querySelector('.bubble.user b')).toBeNull();
  });

  it('shows the progress line and the draft under a running question', () => {
    draw(
      build([
        STARTED,
        ASK('How?'),
        { type: 'progress', message: 'Searching Confluence…' },
        { type: 'token', text: 'Refunds' },
      ]),
    );

    expect(list.querySelector('output.progress')?.textContent).toBe('Searching Confluence…');
    expect(list.querySelector('.answer.draft')?.textContent).toBe('Refunds');
    expect(list.textContent).toContain('Draft. The sources are still being checked');
  });

  it('says it is starting before the first progress line', () => {
    draw(build([STARTED, ASK('How?')]));

    expect(list.querySelector('output.progress')?.textContent).toBe('Starting…');
    expect(list.querySelector('.answer.draft')).toBeNull();
  });

  it('shows an answer as a card, with its own collapsed Sources panel', () => {
    draw(build([STARTED, ASK('How?'), DONE()]));

    expect(list.querySelectorAll('.card')).toHaveLength(1);
    expect(list.querySelector('.card details.sources summary')?.textContent).toBe('Sources (2)');
    expect(list.querySelector('output.progress')).toBeNull();
  });

  it('shows each turn of a conversation in order, each answer with its own Sources panel', () => {
    draw(
      build([
        STARTED,
        ASK('One'),
        DONE({ answerId: 'a1', turn: 1 }),
        ASK('Two'),
        DONE({ answerId: 'a2', turn: 2 }),
      ]),
    );

    expect(
      [...list.querySelectorAll('.bubble.user .text')].map(({ textContent }) => textContent),
    ).toEqual(['One', 'Two']);
    expect(
      [...list.querySelectorAll('details.sources')].map((panel) =>
        panel.getAttribute('data-answer-id'),
      ),
    ).toEqual(['a1', 'a2']);
    expect(list.querySelector('li.turn[data-turn="2"]')).not.toBeNull();
  });

  it('says a question was stopped, with an unchecked draft if there is one', () => {
    draw(build([STARTED, ASK('How?'), { type: 'stop' }]));
    expect(list.querySelector('.notice')?.textContent).toBe('Stopped.');

    draw(build([STARTED, ASK('How?'), { type: 'token', text: 'half' }, { type: 'stop' }]));
    expect(list.querySelector('.notice')?.textContent).toBe(
      'Stopped. What you see is an unchecked draft.',
    );
    expect(list.querySelector('.answer.draft')?.textContent).toBe('half');
  });

  it('shows what went wrong for a question that failed, as an alert', () => {
    draw(
      build([
        STARTED,
        ASK('How?'),
        { type: 'error', kind: 'copilot', message: 'Copilot could not answer just now.' },
      ]),
    );

    const error = list.querySelector('p.error');
    expect(error?.textContent).toBe('Copilot could not answer just now.');
    expect(error?.getAttribute('role')).toBe('alert');
  });

  it('marks a question that asked for more detail', () => {
    draw(build([STARTED, { type: 'ask', question: 'How?', detailLevel: 'more' }]));

    expect(list.querySelector('.bubble.user')?.textContent).toContain('Asked for more detail.');
  });
});

describe('drawing again', () => {
  it('leaves a turn alone when nothing about it changed', () => {
    const answered = build([STARTED, ASK('One'), DONE()]);
    draw(answered);
    const before = list.querySelector('li.turn');

    draw(build([{ type: 'notice', text: 'Something else changed.' }], answered));

    expect(list.querySelector('li.turn')).toBe(before);
    expect(list.querySelectorAll('li.turn')).toHaveLength(1);
  });

  it('draws a turn again when its answer changes, and keeps the others', () => {
    const answered = build([
      STARTED,
      ASK('One'),
      DONE(),
      ASK('Two'),
      DONE({ answerId: 'a2', turn: 2 }),
    ]);
    draw(answered);
    const [first, second] = list.querySelectorAll('li.turn');

    draw(
      build(
        [
          {
            type: 'recheck',
            payload: { updates: [makeAnswer({ answerId: 'a2', turn: 2, changedKeys: ['C1'] })] },
          },
        ],
        answered,
      ),
    );

    const [firstAfter, secondAfter] = list.querySelectorAll('li.turn');
    expect(firstAfter).toBe(first);
    expect(secondAfter).not.toBe(second);
    expect(secondAfter?.querySelector('.changed-note')).not.toBeNull();
  });

  it('keeps a Sources panel open that the reader opened', () => {
    const answered = build([STARTED, ASK('One'), DONE()]);
    draw(answered);
    open.add('a1');

    draw(
      build(
        [{ type: 'recheck', payload: { updates: [makeAnswer({ changedKeys: ['C1'] })] } }],
        answered,
      ),
    );

    expect(/** @type {HTMLDetailsElement} */ (list.querySelector('details.sources')).open).toBe(
      true,
    );
  });

  it('keeps focus on the same button when its turn is drawn again', () => {
    const answered = build([STARTED, ASK('One'), DONE()]);
    draw(answered);
    const button = /** @type {HTMLElement} */ (list.querySelector('[data-action="recheck"]'));
    button.focus();

    draw(build([{ type: 'checking', answerId: 'a1', on: true }], answered));

    const again = list.querySelector('[data-action="recheck"]');
    expect(again).not.toBe(button);
    expect(document.activeElement).toBe(again);
  });

  it('does not take focus from a field that is not one of the turn’s buttons', () => {
    const answered = build([STARTED, ASK('One'), DONE()]);
    draw(answered);
    document.body.insertAdjacentHTML('beforeend', '<textarea id="other"></textarea>');
    const field = /** @type {HTMLElement} */ (document.querySelector('#other'));
    field.focus();

    draw(build([{ type: 'checking', answerId: 'a1', on: true }], answered));

    expect(document.activeElement).toBe(field);
  });

  it('lets go of focus quietly when the button it was on is gone', () => {
    const answered = build([STARTED, ASK('One'), DONE()]);
    draw(answered);
    /** @type {HTMLElement} */ (list.querySelector('[data-action="recheck"]')).focus();

    draw(build([{ type: 'reset' }], answered));

    expect(list.children).toHaveLength(0);
  });

  it('removes the turns that are no longer in the state', () => {
    draw(build([STARTED, ASK('One'), DONE(), ASK('Two')]));

    draw(build([STARTED, ASK('Fresh')]));

    expect(list.querySelectorAll('li.turn')).toHaveLength(1);
    expect(list.querySelector('.text')?.textContent).toBe('Fresh');
  });

  it('shows a Re-ask button only for an answer whose sources have changed, and More detail only on the newest', () => {
    const state = build([
      STARTED,
      ASK('One'),
      DONE({ answerId: 'a1', turn: 1, changedKeys: ['C1'] }),
      ASK('Two'),
      DONE({ answerId: 'a2', turn: 2 }),
    ]);

    draw(state);

    expect(list.querySelector('[data-action="reask"][data-answer-id="a1"]')).not.toBeNull();
    expect(list.querySelector('[data-action="reask"][data-answer-id="a2"]')).toBeNull();
    expect(list.querySelector('[data-action="more"][data-answer-id="a2"]')).not.toBeNull();
    expect(list.querySelector('[data-action="more"][data-answer-id="a1"]')).toBeNull();
  });
});
