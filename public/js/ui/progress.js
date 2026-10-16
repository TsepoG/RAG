// @ts-check
import { el } from '../dom.js';
import { describeSteps } from '../steps.js';
import { icon } from './icons.js';

/** Said above the text that is still being checked. */
export const DRAFT_LABEL = 'Draft: sources still being checked';

/** The words a screen reader hears before each row, because the row's look is not enough on its own. */
const STATUS_WORDS = Object.freeze({
  done: 'Done: ',
  current: 'In progress: ',
  future: 'Waiting: ',
});

/**
 * Builds the round marker of a row: a check once it is done, a spinner while it runs, and an empty
 * ring while it waits.
 * @param {'done' | 'current' | 'future'} status - Where the step is.
 * @returns {HTMLElement} The marker.
 */
function buildMarker(status) {
  const marker = el('span', {
    className: `progress__marker progress__marker--${status}`,
    attributes: { 'aria-hidden': 'true' },
  });
  if (status === 'done') {
    marker.append(icon('check', { size: 12, strokeWidth: 3 }));
  }
  return marker;
}

/**
 * Builds the list of steps.
 * @param {import('../steps.js').StepProgress} progress - Where the steps stand.
 * @returns {HTMLElement} An ordered list.
 */
function buildSteps(progress) {
  const rows = describeSteps(progress).map(({ id, label, status }) =>
    el(
      'li',
      { className: `progress__step progress__step--${status}`, attributes: { 'data-step': id } },
      [
        buildMarker(status),
        el('span', { className: 'visually-hidden', text: STATUS_WORDS[status] }),
        el('span', { className: 'progress__label', text: label }),
      ],
    ),
  );
  return el('ol', { className: 'progress__steps', attributes: { 'aria-label': 'Progress' } }, rows);
}

/**
 * Builds the draft: what has been written so far, in a muted colour, with a caret. It is plain
 * text, because it has not been checked yet.
 * @param {string} draft - The text so far.
 * @returns {HTMLElement} The draft block.
 */
function buildDraft(draft) {
  return el('div', { className: 'progress__draft' }, [
    el('span', { className: 'progress__draft-label', text: DRAFT_LABEL }),
    el('p', { className: 'progress__draft-text', text: draft }, [
      el('span', { className: 'progress__caret', attributes: { 'aria-hidden': 'true' } }),
    ]),
  ]);
}

/**
 * Builds the card shown in place of an answer while a question runs: the steps so far and, once
 * text arrives, the draft under them. It is marked busy until the answer replaces it.
 * @param {{ steps: ReadonlyArray<import('../steps.js').Step>, currentStep: string, draft: string }} turn - The running turn.
 * @returns {HTMLElement} The card.
 */
export function buildProgressCard({ steps, currentStep, draft }) {
  const card = el('article', {
    className: 'card card--working progress',
    attributes: { 'aria-busy': 'true', 'aria-label': 'Working on the answer' },
  });
  card.append(buildSteps({ steps, currentStep }));
  if (draft !== '') {
    card.append(buildDraft(draft));
  }
  return card;
}
