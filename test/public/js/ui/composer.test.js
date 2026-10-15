// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { buildComposer, QUESTION_ID, updateComposer } from '../../../../public/js/ui/composer.js';

/**
 * Builds a composer in the document.
 * @param {Partial<import('../../../../public/js/ui/composer.js').ComposerState>} [changes] - Parts to change.
 * @returns {HTMLFormElement} The form.
 */
function build(changes = {}) {
  const form = buildComposer({ turnsUsed: 0, maxTurns: 5, busy: false, hidden: false, ...changes });
  document.body.replaceChildren(form);
  return form;
}

/**
 * @param {HTMLFormElement} form - The form.
 * @returns {Record<string, HTMLElement>} Its parts.
 */
function parts(form) {
  const find = (/** @type {string} */ selector) =>
    /** @type {HTMLElement} */ (form.querySelector(selector));
  return {
    label: find('label'),
    field: find('textarea'),
    send: find('.composer__send'),
    stop: find('.composer__stop'),
    note: find('.composer__note'),
  };
}

describe('the composer before the first question', () => {
  it('is a form with a labelled question box that the skip link can reach', () => {
    const form = build();

    const { label, field } = parts(form);
    expect(form.tagName).toBe('FORM');
    expect(field.id).toBe(QUESTION_ID);
    expect(QUESTION_ID).toBe('question');
    expect(label.getAttribute('for')).toBe('question');
    expect(label.textContent).toBe('Your question');
    expect(field.getAttribute('maxlength')).toBe('2000');
  });

  it('has a button that says Ask, and says how many questions a conversation holds', () => {
    const { send, note, stop } = parts(build({ maxTurns: 5 }));

    expect(send.textContent).toBe('Ask');
    expect(send.getAttribute('type')).toBe('submit');
    expect(note.textContent).toBe('Up to 5 questions per conversation');
    expect(stop.hidden).toBe(true);
  });

  it('describes the box by the line under it', () => {
    const { field, note } = parts(build());

    expect(field.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('asks for anything in the box', () => {
    expect(/** @type {HTMLTextAreaElement} */ (parts(build()).field).placeholder).toBe(
      'Ask anything about the system…',
    );
  });

  it('hides the arrow icon from screen readers', () => {
    expect(parts(build()).send.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the composer after the first question', () => {
  it('says Ask a follow-up and Send, and how many turns are left', () => {
    const form = build({ turnsUsed: 2, maxTurns: 5 });

    const { label, send, note, field } = parts(form);
    expect(label.textContent).toBe('Ask a follow-up');
    expect(send.textContent).toBe('Send');
    expect(note.textContent).toBe('3 turns left in this conversation');
    expect(/** @type {HTMLTextAreaElement} */ (field).placeholder).toBe('Ask a follow-up…');
  });

  it('says 1 turn, not 1 turns, for the last one', () => {
    expect(parts(build({ turnsUsed: 4, maxTurns: 5 })).note.textContent).toBe(
      '1 turn left in this conversation',
    );
  });

  it('never says a negative number of turns are left', () => {
    expect(parts(build({ turnsUsed: 7, maxTurns: 5 })).note.textContent).toBe(
      '0 turns left in this conversation',
    );
  });
});

describe('the composer while a question runs', () => {
  it('turns the box off, says why, and swaps Send for Stop', () => {
    const { field, send, stop } = parts(build({ turnsUsed: 1, busy: true }));

    expect(/** @type {HTMLTextAreaElement} */ (field).disabled).toBe(true);
    expect(/** @type {HTMLTextAreaElement} */ (field).placeholder).toBe(
      'Wait for this answer to finish…',
    );
    expect(send.hidden).toBe(true);
    expect(stop.hidden).toBe(false);
    expect(stop.getAttribute('type')).toBe('button');
    expect(stop.getAttribute('data-action')).toBe('stop');
    expect(stop.textContent).toBe('Stop');
  });

  it('tells how long an answer usually takes, in place of the turns left', () => {
    const { note } = parts(build({ turnsUsed: 1, busy: true }));

    expect(note.textContent).toBe('Most answers take 1–3 minutes');
    expect(note.querySelector('.time-hint')).not.toBeNull();
  });

  it('gives Stop a name and hides its icon from screen readers', () => {
    const { stop } = parts(build({ busy: true }));

    expect(stop.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(stop.textContent?.trim()).toBe('Stop');
  });
});

describe('updateComposer', () => {
  it('keeps what the reader typed and the box itself when the state changes', () => {
    const form = build();
    const { field } = parts(form);
    /** @type {HTMLTextAreaElement} */ (field).value = 'half a question';

    updateComposer(form, { turnsUsed: 1, maxTurns: 5, busy: true, hidden: false });
    updateComposer(form, { turnsUsed: 1, maxTurns: 5, busy: false, hidden: false });

    expect(parts(form).field).toBe(field);
    expect(/** @type {HTMLTextAreaElement} */ (field).value).toBe('half a question');
  });

  it('goes back to Send and the turns left once the answer is done', () => {
    const form = build({ turnsUsed: 1, busy: true });

    updateComposer(form, { turnsUsed: 2, maxTurns: 5, busy: false, hidden: false });

    const { send, stop, note, field } = parts(form);
    expect(send.hidden).toBe(false);
    expect(stop.hidden).toBe(true);
    expect(note.textContent).toBe('3 turns left in this conversation');
    expect(/** @type {HTMLTextAreaElement} */ (field).disabled).toBe(false);
  });

  it('hides the whole form while something else, such as the end card, takes its place', () => {
    const form = build();

    updateComposer(form, { turnsUsed: 5, maxTurns: 5, busy: false, hidden: true });
    expect(form.hidden).toBe(true);

    updateComposer(form, { turnsUsed: 0, maxTurns: 5, busy: false, hidden: false });
    expect(form.hidden).toBe(false);
  });

  it('puts no inline style on anything', () => {
    expect(build({ busy: true }).querySelectorAll('[style]')).toHaveLength(0);
  });
});
