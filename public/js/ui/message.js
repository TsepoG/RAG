// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** Shown for a question the reader stopped. */
export const STOPPED_TEXT = 'Stopped.';

/** Shown for a question the reader stopped after some of the answer had arrived. */
export const STOPPED_WITH_DRAFT_TEXT = 'Stopped. What you see is an unchecked draft.';

/** Said under a question that was asked for more detail. */
const MORE_DETAIL_NOTE = 'Asked for more detail.';

/**
 * Builds the reader's question: a dark bubble on the right. Screen readers hear who spoke.
 * @param {{ question: string, detailLevel: 'default' | 'more' }} turn - The question and the level it was asked at.
 * @returns {HTMLElement} The bubble.
 */
export function buildUserMessage({ question, detailLevel }) {
  return el('div', { className: 'bubble' }, [
    el('p', { className: 'bubble__text' }, [
      el('span', { className: 'visually-hidden', text: 'You asked: ' }),
      question,
    ]),
    ...(detailLevel === 'more'
      ? [el('p', { className: 'bubble__note', text: MORE_DETAIL_NOTE })]
      : []),
  ]);
}

/**
 * Builds the card for a question the reader stopped: a neutral pill and, when some of the answer
 * had arrived, the unchecked draft in a muted colour.
 * @param {{ turn: number, draft: string }} input - The turn and the draft so far.
 * @returns {HTMLElement} The card.
 */
export function buildStoppedCard({ turn, draft }) {
  return el(
    'article',
    {
      className: 'card answer-card answer-card--stopped',
      attributes: { 'data-turn': String(turn) },
    },
    [
      el('header', { className: 'answer-card__header' }, [
        el('span', { className: 'pill pill--neutral' }, [
          icon('no-entry', { size: 14, strokeWidth: 2.2 }),
          el('span', { text: 'Stopped' }),
        ]),
        el('span', { className: 'answer-card__turn', text: `Turn ${turn}` }),
      ]),
      ...(draft === '' ? [] : [el('p', { className: 'answer-card__draft', text: draft })]),
      el('p', {
        className: 'answer-card__notice',
        text: draft === '' ? STOPPED_TEXT : STOPPED_WITH_DRAFT_TEXT,
      }),
    ],
  );
}
