// @ts-check
import { canAsk, canReask, canShowMoreDetail } from './chatState.js';
import { el } from './dom.js';
import { buildAnswerCard, buildErrorCard } from './ui/answerCard.js';
import { buildStoppedCard, buildUserMessage } from './ui/message.js';
import { buildProgressCard } from './ui/progress.js';

/**
 * What is needed to draw the turns, besides the state.
 * @typedef {object} ListContext
 * @property {number} now - The time now, in ms.
 * @property {Set<string>} openSources - Ids of the answers whose Sources list is open.
 * @property {boolean} [signInNeeded] - Whether the Atlassian sign-in must be renewed first; a retry
 *   would only be refused again, so Try again is not offered.
 */

/**
 * What a drawn turn was drawn from. When none of it has changed, the turn is not drawn again.
 * @typedef {object} Drawn
 * @property {HTMLElement} node - The turn's list item.
 * @property {unknown[]} inputs - What it was drawn from.
 */

/**
 * Whether a failed turn can be asked again: it is the newest, the conversation can take it, and no
 * sign-in is needed first.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @param {ListContext} context - Whether a sign-in is needed.
 * @returns {boolean} True when Try again is offered.
 */
function canRetry(state, turn, context) {
  return turn === state.turns.at(-1) && canAsk(state) && context.signInNeeded !== true;
}

/**
 * Builds the reply to a turn: the answer, the progress of one that is running, or what became of
 * one that was stopped or failed.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @param {ListContext} context - The time and what is open.
 * @returns {HTMLElement} The card.
 */
function buildReply(state, turn, context) {
  const { answer } = turn;
  if (turn.phase === 'answered' && answer !== undefined) {
    return buildAnswerCard({
      answer,
      now: context.now,
      sourcesOpen: context.openSources.has(answer.answerId),
      checking: state.checking.includes(answer.answerId),
      canReask: canReask(state, turn),
      canMoreDetail: canShowMoreDetail(state, turn),
      rating: state.ratings[answer.answerId],
    });
  }
  if (turn.phase === 'running') {
    return buildProgressCard(turn);
  }
  if (turn.phase === 'stopped') {
    return buildStoppedCard(turn);
  }
  return buildErrorCard({
    turn: turn.turn,
    message: /** @type {string} */ (turn.failure),
    canRetry: canRetry(state, turn, context),
  });
}

/**
 * Builds one turn of the conversation: the question, and the answer or what became of it.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @param {import('./chatState.js').TurnView} turn - The turn.
 * @param {ListContext} context - The time and what is open.
 * @returns {HTMLElement} The turn's list item.
 */
function buildTurn(state, turn, context) {
  return el('li', { className: 'turn', attributes: { 'data-turn': String(turn.turn) } }, [
    buildUserMessage(turn),
    buildReply(state, turn, context),
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
    canRetry(state, turn, context),
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
 * Sources lists the reader opened stay open, and the control that had focus keeps it.
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
