// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import { showRoles, showState } from '../../../public/js/render.js';
import { INITIAL_STATE, next } from '../../../public/js/state.js';
import { loadPage, makePayload } from '../../helpers/page.js';

const ROLES = [
  { id: 'developer', displayName: 'Developer', description: 'Technical answers.', depth: 3 },
  { id: 'product_owner', displayName: 'Product Owner', description: 'Plain language.', depth: 1 },
];

const ASK = /** @type {const} */ ({
  type: 'ask',
  question: 'How do refunds work?',
  role: 'product_owner',
  roleDepth: 1,
  detailLevel: 'default',
});

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
});

/**
 * Applies actions to a new state.
 * @param {import('../../../public/js/state.js').PageAction[]} actions - What happened.
 * @returns {import('../../../public/js/state.js').PageState} The state.
 */
function run(actions) {
  return actions.reduce(
    next,
    /** @type {import('../../../public/js/state.js').PageState} */ (INITIAL_STATE),
  );
}

describe('showRoles', () => {
  it('offers every role by name and selects the remembered one', () => {
    const chosen = showRoles(refs, ROLES, 'product_owner');

    const select = /** @type {HTMLSelectElement} */ (refs.role);
    expect([...select.options].map(({ text }) => text)).toEqual(['Developer', 'Product Owner']);
    expect(select.value).toBe('product_owner');
    expect(select.disabled).toBe(false);
    expect(chosen?.id).toBe('product_owner');
    expect(refs.roleDescription.textContent).toBe('Plain language.');
  });

  it('selects the first role when none was remembered, or the remembered one is gone', () => {
    expect(showRoles(refs, ROLES, undefined)?.id).toBe('developer');
    expect(showRoles(refs, ROLES, 'retired_role')?.id).toBe('developer');
    expect(/** @type {HTMLSelectElement} */ (refs.role).value).toBe('developer');
  });

  it('writes a role name that holds HTML as text', () => {
    showRoles(refs, [{ ...ROLES[0], displayName: '<img src=x onerror=alert(1)>' }], undefined);

    expect(refs.role.querySelector('img')).toBeNull();
  });

  it('disables the picker, and says nothing, when there are no roles', () => {
    const chosen = showRoles(refs, [], undefined);

    expect(chosen).toBeUndefined();
    expect(/** @type {HTMLSelectElement} */ (refs.role).disabled).toBe(true);
    expect(refs.roleDescription.textContent).toBe('');
  });
});

describe('showState', () => {
  it('shows only the question form before anything is asked', () => {
    showState(refs, INITIAL_STATE);

    expect(refs.result.hidden).toBe(true);
    expect(refs.stop.hidden).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(false);
  });

  it('shows Stop and locks Ask while a question runs, with a starting line', () => {
    showState(refs, run([ASK]));

    expect(refs.result.hidden).toBe(false);
    expect(refs.stop.hidden).toBe(false);
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(true);
    expect(refs.progress.textContent).toBe('Starting…');
    expect(refs.form.hasAttribute('aria-busy')).toBe(true);
  });

  it('shows the latest progress line', () => {
    showState(refs, run([ASK, { type: 'progress', message: 'Searching Confluence…' }]));

    expect(refs.progress.textContent).toBe('Searching Confluence…');
  });

  it('shows the draft as plain muted text, with a note that it is not checked', () => {
    showState(refs, run([ASK, { type: 'token', text: 'Refunds <b>work</b>' }]));

    expect(refs.answer.className).toBe('answer draft');
    expect(refs.answer.textContent).toBe('Refunds <b>work</b>');
    expect(refs.answer.querySelector('b')).toBeNull();
    expect(refs.draftNote.hidden).toBe(false);
  });

  it('hides the draft note until there is a draft', () => {
    showState(refs, run([ASK]));

    expect(refs.draftNote.hidden).toBe(true);
  });

  it('replaces the draft with the finished answer, sources and follow-up controls', () => {
    showState(
      refs,
      run([ASK, { type: 'token', text: 'draft' }, { type: 'done', payload: makePayload() }]),
    );

    expect(refs.stop.hidden).toBe(true);
    expect(refs.progress.textContent).toBe('');
    expect(refs.answer.className).toBe('answer');
    expect(refs.answer.querySelector('button.cite')).not.toBeNull();
    expect(refs.answer.textContent).not.toContain('draft');
    expect(refs.sources.hidden).toBe(false);
    expect(refs.followUp.hidden).toBe(false);
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(false);
  });

  it('offers more detail for a less technical role, once', () => {
    showState(refs, run([ASK, { type: 'done', payload: makePayload() }]));
    expect(refs.moreDetail.hidden).toBe(false);

    showState(
      refs,
      run([
        { ...ASK, roleDepth: 3 },
        { type: 'done', payload: makePayload() },
      ]),
    );
    expect(refs.moreDetail.hidden).toBe(true);

    showState(
      refs,
      run([
        { ...ASK, detailLevel: 'more' },
        { type: 'done', payload: makePayload() },
      ]),
    );
    expect(refs.moreDetail.hidden).toBe(true);
  });

  it('offers no more detail when the answer was not found', () => {
    const payload = makePayload({ result: { status: 'not_found' } });

    showState(refs, run([ASK, { type: 'done', payload }]));

    expect(refs.moreDetail.hidden).toBe(true);
  });

  it('starts the feedback controls afresh for each answer', () => {
    showState(refs, run([ASK, { type: 'done', payload: makePayload() }]));

    expect(refs.feedbackSource.querySelectorAll('option')).toHaveLength(3);
    expect(refs.feedbackForm.hidden).toBe(true);
  });

  it('shows a failure with the message and a way to try again, and hides the rest', () => {
    showState(refs, run([ASK, { type: 'error', kind: 'timeout', message: 'That took too long.' }]));

    expect(refs.error.hidden).toBe(false);
    expect(refs.errorMessage.textContent).toBe('That took too long.');
    expect(refs.followUp.hidden).toBe(true);
    expect(refs.banner.hidden).toBe(true);
    expect(refs.stop.hidden).toBe(true);
  });

  it('shows that it stopped, and keeps the draft, marked as unchecked', () => {
    showState(refs, run([ASK, { type: 'token', text: 'half an answer' }, { type: 'stop' }]));

    expect(refs.notice.hidden).toBe(false);
    expect(refs.notice.textContent).toBe('Stopped. What you see is an unchecked draft.');
    expect(refs.answer.textContent).toBe('half an answer');
    expect(refs.error.hidden).toBe(true);
  });

  it('just says it stopped when there was no draft', () => {
    showState(refs, run([ASK, { type: 'stop' }]));

    expect(refs.notice.textContent).toBe('Stopped.');
    expect(refs.answer.textContent).toBe('');
  });

  it('clears the old answer when a new question starts', () => {
    showState(refs, run([ASK, { type: 'done', payload: makePayload() }]));

    showState(refs, run([ASK]));

    expect(refs.answer.textContent).toBe('');
    expect(refs.sources.hidden).toBe(true);
    expect(refs.followUp.hidden).toBe(true);
    expect(refs.banner.hidden).toBe(true);
  });

  it('shows nothing for a finished state that has no answer', () => {
    showState(refs, { ...INITIAL_STATE, phase: 'done' });

    expect(refs.followUp.hidden).toBe(true);
  });
});
