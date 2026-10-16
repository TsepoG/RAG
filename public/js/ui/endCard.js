// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** The words for a conversation that ended for a reason the page cannot tell apart. */
const EXPIRED = Object.freeze({
  title: 'This conversation has expired',
  body: 'It was idle too long or the app restarted. Start a new one to keep going.',
});

/**
 * Words for each reason a conversation can end, as the title and the line under it.
 * @type {Readonly<Record<string, (maxTurns: number) => { title: string, body: string }>>}
 */
const REASONS = Object.freeze({
  turns: (maxTurns) => ({
    title: `This conversation has reached its ${maxTurns} questions`,
    body: 'Start a new one to keep going. Long conversations make answers less reliable, so we keep them short.',
  }),
  budget: () => ({
    title: 'This conversation has read as much as it can',
    body: 'It has used its share of source text. Start a new one to keep going.',
  }),
  truncated: () => ({
    title: "Earlier sources dropped out of the assistant's memory",
    body: 'So that no answer relies on text it can no longer see, this conversation has ended.',
  }),
  'session-error': () => ({
    title: 'The assistant lost this conversation',
    body: 'Something went wrong with its connection. Start a new one to keep going.',
  }),
  'abort-unconfirmed': () => ({
    title: "This conversation was stopped and can't continue",
    body: "A question was stopped and the assistant didn't confirm it had stopped, so it is safer to start again.",
  }),
  replaced: () => ({
    title: 'A newer conversation took over',
    body: 'Only one conversation runs at a time. Start a new one to keep going.',
  }),
  deleted: () => ({
    title: 'This conversation was closed',
    body: 'Start a new one to keep going.',
  }),
});

/**
 * Finds the words for the reason a conversation ended. A reason the page has no words for, such as
 * a conversation that expired, gets the words for an expired one.
 * @param {string} reason - Why it ended: `turns` or `budget` when it is full, or what the server said.
 * @param {number} maxTurns - How many questions a conversation may hold.
 * @returns {{ title: string, body: string }} The title and the line under it.
 */
export function describeEnd(reason, maxTurns) {
  const words = Object.hasOwn(REASONS, reason) ? REASONS[reason] : undefined;
  return words === undefined ? EXPIRED : words(maxTurns);
}

/**
 * How the final check of the sources came out.
 * @typedef {object} CheckSummary
 * @property {number} total - How many different sources the answers cite.
 * @property {number} unchanged - How many were checked and are as they were.
 * @property {number} changed - How many changed after they were read.
 * @property {number} unavailable - How many could not be checked.
 * @property {number} unchecked - How many were never checked.
 */

/**
 * Sums up what is known about the sources of a conversation, each counted once by its key, as it
 * stands in the latest answer that cites it.
 * @param {ReadonlyArray<{ answer: { sourceStates: ReadonlyArray<{ key: string, changed: boolean, check: { status: string } | null }> } | undefined }>} turns - The turns.
 * @returns {CheckSummary} The counts.
 */
export function summariseChecks(turns) {
  /** @type {Map<string, { changed: boolean, check: { status: string } | null }>} */
  const latest = new Map();
  for (const { answer } of turns) {
    for (const { key, changed, check } of answer?.sourceStates ?? []) {
      latest.set(key, { changed, check });
    }
  }
  const states = [...latest.values()];
  const isChanged = (/** @type {{ changed: boolean, check: { status: string } | null }} */ state) =>
    state.changed || state.check?.status === 'changed';
  const changed = states.filter(isChanged).length;
  const unavailable = states.filter(
    (state) => !isChanged(state) && state.check?.status === 'unavailable',
  ).length;
  const unchecked = states.filter((state) => !isChanged(state) && state.check === null).length;
  return {
    total: states.length,
    changed,
    unavailable,
    unchecked,
    unchanged: states.length - changed - unavailable - unchecked,
  };
}

/**
 * Says how the sources came out, or nothing when the answers cited none.
 * @param {CheckSummary} summary - The counts.
 * @returns {HTMLElement[]} The line, or none.
 */
function buildSummaryLine({ total, unchanged, changed, unavailable, unchecked }) {
  if (total === 0) {
    return [];
  }
  const noun = total === 1 ? 'source' : 'sources';
  const intro =
    unchecked === 0 ? `Final check of all ${total} ${noun}: ` : `Checks on ${total} ${noun}: `;
  /** @type {Array<[number, string, string]>} */
  const parts = [
    [unchanged, 'unchanged', 'summary__unchanged'],
    [changed, 'changed', 'summary__changed'],
    [unavailable, "couldn't be checked", 'summary__unavailable'],
    [unchecked, 'not checked', 'summary__unchecked'],
  ];
  const shown = parts.filter(([count]) => count > 0);
  const children = shown.flatMap(([count, words, className], index) => [
    ...(index === 0 ? [] : [', ']),
    el('strong', { className, text: `${count} ${words}` }),
  ]);
  return [
    el('p', { className: 'end-card__summary' }, [
      icon('refresh', { size: 16 }),
      el('span', {}, [
        intro,
        ...children,
        ...(changed > 0 ? [' (shown on the answer that used it)'] : []),
      ]),
    ]),
  ];
}

/**
 * Builds the card that replaces the question box when a conversation can go no further: why, how
 * the sources came out, and the ways forward.
 * @param {{ reason: string, maxTurns: number, summary: CheckSummary }} input - Why it ended, the turn limit and the check summary.
 * @returns {HTMLElement} The card.
 */
export function buildEndCard({ reason, maxTurns, summary }) {
  const { title, body } = describeEnd(reason, maxTurns);
  return el(
    'section',
    { className: 'end-card', attributes: { 'aria-label': 'Conversation ended' } },
    [
      el('div', { className: 'end-card__words' }, [
        el('h2', { className: 'end-card__title', text: title, attributes: { tabindex: '-1' } }),
        el('p', { className: 'end-card__body', text: body }),
      ]),
      ...buildSummaryLine(summary),
      el('div', { className: 'end-card__actions' }, [
        el('button', {
          className: 'button button--primary',
          text: 'Start a new conversation',
          attributes: { type: 'button', 'data-action': 'new-conversation' },
        }),
        el('button', {
          className: 'button',
          text: 'Copy this conversation',
          attributes: { type: 'button', 'data-action': 'copy-conversation' },
        }),
      ]),
    ],
  );
}
