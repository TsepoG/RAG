// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';
import { buildTimeHint } from './timeHint.js';

/** The id of the question box; the skip link and the labels point to it. */
export const QUESTION_ID = 'question';

/** The id of the line under the box, which the box is described by. */
const NOTE_ID = 'question-note';

/** The longest question the server takes. */
const MAX_QUESTION_LENGTH = 2000;

/** What the box says before the first question and after it. */
const FIRST_LABEL = 'Your question';
const FOLLOW_UP_LABEL = 'Ask a follow-up';
const FIRST_PLACEHOLDER = 'Ask anything about the system…';
const FOLLOW_UP_PLACEHOLDER = 'Ask a follow-up…';
const BUSY_PLACEHOLDER = 'Wait for this answer to finish…';

/**
 * What the composer shows.
 * @typedef {object} ComposerState
 * @property {number} turnsUsed - How many questions the conversation has had.
 * @property {number} maxTurns - How many it may have.
 * @property {boolean} busy - Whether a question is being answered.
 * @property {boolean} hidden - Whether the composer is replaced by something else, such as the end card.
 */

/**
 * Builds the question form. It is built once and kept, so what the reader has typed and where the
 * cursor is survive every change; {@link updateComposer} changes the rest.
 * @param {ComposerState} state - What the composer shows to begin with.
 * @returns {HTMLFormElement} The form.
 */
export function buildComposer(state) {
  const label = el('label', {
    className: 'composer__label',
    attributes: { for: QUESTION_ID },
  });
  const field = el('textarea', {
    className: 'composer__field',
    attributes: {
      id: QUESTION_ID,
      name: 'question',
      rows: '2',
      maxlength: String(MAX_QUESTION_LENGTH),
      'aria-describedby': NOTE_ID,
      required: '',
    },
  });
  const send = el('button', {
    className: 'button button--primary composer__send',
    attributes: { type: 'submit' },
  });
  send.append(
    el('span', { className: 'composer__send-text' }),
    icon('send', { size: 20, strokeWidth: 2.2 }),
  );
  const stop = el(
    'button',
    {
      className: 'button composer__stop',
      attributes: { type: 'button', 'data-action': 'stop' },
    },
    [icon('stop', { size: 14, filled: true }), el('span', { text: 'Stop' })],
  );
  stop.hidden = true;
  const form = /** @type {HTMLFormElement} */ (
    el('form', { className: 'composer', attributes: { autocomplete: 'off' } }, [
      label,
      field,
      el('div', { className: 'composer__footer' }, [
        el('span', { className: 'composer__note', attributes: { id: NOTE_ID } }),
        send,
        stop,
      ]),
    ])
  );
  updateComposer(form, state);
  return form;
}

/**
 * Words for the line under the box: how many questions are left, or, while a question runs, how
 * long an answer usually takes.
 * @param {ComposerState} state - What the composer shows.
 * @returns {string | HTMLElement} The line.
 */
function noteFor({ turnsUsed, maxTurns, busy }) {
  const hint = busy ? buildTimeHint() : undefined;
  if (hint !== undefined) {
    return hint;
  }
  if (turnsUsed === 0) {
    return `Up to ${maxTurns} questions per conversation`;
  }
  const left = Math.max(0, maxTurns - turnsUsed);
  return `${left} ${left === 1 ? 'turn' : 'turns'} left in this conversation`;
}

/**
 * Words inside the empty box.
 * @param {ComposerState} state - What the composer shows.
 * @returns {string} The placeholder.
 */
function placeholderFor({ turnsUsed, busy }) {
  if (busy) {
    return BUSY_PLACEHOLDER;
  }
  return turnsUsed === 0 ? FIRST_PLACEHOLDER : FOLLOW_UP_PLACEHOLDER;
}

/**
 * Changes the form to match the conversation: the label and the button say Ask before the first
 * question and Send after it; while a question runs the box is off and Stop takes the place of
 * Send, beside how long an answer usually takes.
 * @param {HTMLFormElement} form - The form from {@link buildComposer}.
 * @param {ComposerState} state - What the composer shows.
 */
export function updateComposer(form, state) {
  const { turnsUsed, busy, hidden } = state;
  // The form is built by this file, so these parts are always there.
  const part = (/** @type {string} */ selector) =>
    /** @type {HTMLElement} */ (form.querySelector(selector));
  const field = /** @type {HTMLTextAreaElement} */ (part('textarea'));
  const first = turnsUsed === 0;
  form.hidden = hidden;
  part('label').textContent = first ? FIRST_LABEL : FOLLOW_UP_LABEL;
  field.disabled = busy;
  field.placeholder = placeholderFor(state);
  part('.composer__send-text').textContent = first ? 'Ask' : 'Send';
  part('.composer__send').hidden = busy;
  part('.composer__stop').hidden = !busy;
  part('.composer__note').replaceChildren(noteFor(state));
}
