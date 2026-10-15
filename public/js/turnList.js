// @ts-check
import { buildAnswerCard } from './answerCard.js';
import { el } from './dom.js';
import { canReask, canShowMoreDetail } from './chatState.js';

/** Shown before the first progress line arrives. */
const STARTING = 'Starting…';

/** Shown for a question the reader stopped. */
const STOPPED = 'Stopped.';
const STOPPED_WITH_DRAFT = 'Stopped. What you see is an unchecked draft.';

/**
 * What is needed to draw the turns, besides the state.
 * @typedef {object} ListContext
 * @property {number} now - The time now, in ms.
 * @property {Set<string>} openSources - Ids of the answers whose Sources panel is open.
 */

/**
 * What a drawn turn was drawn from. When none of it has changed, the turn is not drawn again.
 * @typedef {object} Drawn
 * @property {HTMLElement} node - The turn's list item.
 * @property {unknown[]} inputs - What it was drawn from.
 */

/**
 * Builds the reader's question.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @returns {HTMLElement} The bubble.
 */
function buildQuestion({ question, detailLevel }) {
  return el('div', { className: 'bubble user' }, [
    el('p', { className: 'who', text: 'You' }),
    el('p', { className: 'text', text: question }),
    ...(detailLevel === 'more'
      ? [el('p', { className: 'hint', text: 'Asked for more detail.' })]
      : []),
  ]);
}

/**
 * Builds the reply to a turn that has no finished answer: the progress and draft of one that is
 * running, or what became of one that was stopped or failed.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @returns {HTMLElement[]} What to show.
 */
function buildUnfinished(turn) {
  const draft =
    turn.draft === ''
      ? []
      : [
          el('div', { className: 'answer draft', text: turn.draft }),
          ...(turn.phase === 'running'
            ? [el('p', { className: 'hint', text: 'Draft. The sources are still being checked…' })]
            : []),
        ];
  if (turn.phase === 'running') {
    return [
      el('output', {
        className: 'progress',
        text: turn.progress === '' ? STARTING : turn.progress,
      }),
      ...draft,
    ];
  }
  if (turn.phase === 'stopped') {
    return [
      ...draft,
      el('p', { className: 'notice', text: turn.draft === '' ? STOPPED : STOPPED_WITH_DRAFT }),
    ];
  }
  return [
    ...draft,
    el('p', { className: 'error', text: turn.failure, attributes: { role: 'alert' } }),
  ];
}

/**
 * Builds one turn of the conversation: the question, and the answer or what became of it.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @param {ListContext} context - The time and what is open.
 * @returns {HTMLElement} The turn's list item.
 */
function buildTurn(state, turn, context) {
  const { answer } = turn;
  const reply =
    turn.phase === 'answered' && answer !== undefined
      ? buildAnswerCard({
          answer,
          now: context.now,
          sourcesOpen: context.openSources.has(answer.answerId),
          checking: state.checking.includes(answer.answerId),
          canReask: canReask(state, turn),
          canMoreDetail: canShowMoreDetail(state, turn),
          rating: state.ratings[answer.answerId],
        })
      : el('div', { className: 'reply' }, buildUnfinished(turn));
  return el('li', { className: 'turn', attributes: { 'data-turn': String(turn.turn) } }, [
    buildQuestion(turn),
    reply,
  ]);
}

/**
 * Lists what a turn is drawn from, so a turn is drawn again only when one of these changes.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @param {ListContext} context - The time and what is open.
 * @returns {unknown[]} The inputs.
 */
function inputsOf(state, turn, context) {
  const id = turn.answer?.answerId;
  return [
    turn,
    id !== undefined && state.checking.includes(id),
    id === undefined ? undefined : state.ratings[id],
    canReask(state, turn),
    canShowMoreDetail(state, turn),
    id !== undefined && context.openSources.has(id),
  ];
}

/**
 * Whether two lists hold the same things.
 * @param {unknown[]} left - One list.
 * @param {unknown[]} right - The other.
 * @returns {boolean} True when each item is the same as its partner.
 */
function sameInputs(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Draws the turns of a conversation into a list, changing only the turns whose state changed. The
 * Sources panels the reader opened stay open, and the control that had focus keeps it.
 * @param {HTMLElement} list - The list element.
 * @param {WeakMap<HTMLElement, Drawn[]>} memory - What was drawn into each list; keep one for the page.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @param {ListContext} context - The time and what is open.
 */
export function drawTurns(list, memory, state, context) {
  const drawn = memory.get(list) ?? [];
  const focusId = document.activeElement?.getAttribute('data-focus-id') ?? undefined;
  state.turns.forEach((turn, index) => {
    const inputs = inputsOf(state, turn, context);
    const before = drawn[index];
    if (before !== undefined && sameInputs(before.inputs, inputs)) {
      return;
    }
    const node = buildTurn(state, turn, context);
    if (before === undefined) {
      list.append(node);
    } else {
      before.node.replaceWith(node);
    }
    drawn[index] = { node, inputs };
  });
  for (const extra of drawn.splice(state.turns.length)) {
    extra.node.remove();
  }
  memory.set(list, drawn);
  if (focusId !== undefined) {
    const same = [...list.querySelectorAll('[data-focus-id]')].find(
      (element) => element.getAttribute('data-focus-id') === focusId,
    );
    if (same instanceof HTMLElement && document.activeElement !== same) {
      same.focus();
    }
  }
}
