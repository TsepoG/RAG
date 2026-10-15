// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_CHAT, next } from '../../../public/js/chatState.js';
import { showRoleConfirm, showRoles, showShell } from '../../../public/js/shell.js';
import { loadPage, makeAnswer, makeConversation } from '../../helpers/page.js';

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

const ROLES = [
  { id: 'dev', displayName: 'Developer', description: 'Writes the code.', depth: 3 },
  { id: 'po', displayName: 'Product Owner', description: 'Owns the product.', depth: 1 },
];

beforeEach(() => {
  refs = loadPage();
});

/**
 * Applies actions to the initial state.
 * @param {import('../../../public/js/chatState.js').ChatAction[]} actions - What happens.
 * @returns {import('../../../public/js/chatState.js').ChatState} The state.
 */
function build(actions) {
  return actions.reduce(next, INITIAL_CHAT);
}

describe('showRoles', () => {
  it('offers every role, selects the one asked for and describes it', () => {
    const chosen = showRoles(refs, ROLES, 'po');

    const select = /** @type {HTMLSelectElement} */ (refs.role);
    expect([...select.options].map(({ value }) => value)).toEqual(['dev', 'po']);
    expect(select.value).toBe('po');
    expect(select.disabled).toBe(false);
    expect(refs.roleDescription.textContent).toBe('Owns the product.');
    expect(chosen?.id).toBe('po');
  });

  it('selects the first role when the one asked for is not offered', () => {
    expect(showRoles(refs, ROLES, 'gone')?.id).toBe('dev');
    expect(showRoles(refs, ROLES, undefined)?.id).toBe('dev');
  });

  it('leaves the picker disabled when there are no roles', () => {
    expect(showRoles(refs, [], undefined)).toBeUndefined();
    expect(/** @type {HTMLSelectElement} */ (refs.role).disabled).toBe(true);
    expect(refs.roleDescription.textContent).toBe('');
  });
});

describe('showShell', () => {
  it('starts as a conversation with no questions: counter, no New conversation button, Ask enabled', () => {
    showShell(refs, INITIAL_CHAT);

    expect(refs.turnCounter.textContent).toBe('No questions yet.');
    expect(refs.newConversation.hidden).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(false);
    expect(refs.stop.hidden).toBe(true);
    expect(refs.fullMessage.hidden).toBe(true);
    expect(refs.notice.hidden).toBe(true);
  });

  it('counts the turns against the cap', () => {
    showShell(
      refs,
      build([{ type: 'started', conversation: makeConversation({ turnCount: 2, maxTurns: 5 }) }]),
    );

    expect(refs.turnCounter.textContent).toBe('Turn 2 of 5');
    expect(refs.newConversation.hidden).toBe(false);
  });

  it('shows Stop and disables Ask while a question runs', () => {
    showShell(
      refs,
      build([
        { type: 'started', conversation: makeConversation({ turnCount: 0 }) },
        { type: 'ask', question: 'q', detailLevel: 'default' },
      ]),
    );

    expect(refs.stop.hidden).toBe(false);
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(true);
    expect(refs.form.hasAttribute('aria-busy')).toBe(true);
  });

  it('says the conversation is full, disables the input and Ask, and keeps New conversation', () => {
    showShell(
      refs,
      build([
        {
          type: 'started',
          conversation: makeConversation({
            turnCount: 5,
            full: 'turns',
            fullMessage: 'This conversation is full — start a new one to keep going.',
          }),
        },
      ]),
    );

    expect(refs.fullMessage.hidden).toBe(false);
    expect(refs.fullMessage.textContent).toBe(
      'This conversation is full — start a new one to keep going.',
    );
    expect(/** @type {HTMLTextAreaElement} */ (refs.question).disabled).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(true);
    expect(refs.newConversation.hidden).toBe(false);
  });

  it('says so when the conversation has ended without being full', () => {
    showShell(
      refs,
      build([{ type: 'started', conversation: makeConversation({ ended: 'truncated' }) }]),
    );

    expect(refs.fullMessage.textContent).toContain('This conversation has ended');
    expect(/** @type {HTMLTextAreaElement} */ (refs.question).disabled).toBe(true);
  });

  it('says it too when the full message is missing', () => {
    showShell(
      refs,
      build([
        { type: 'started', conversation: makeConversation({ full: 'budget', fullMessage: null }) },
      ]),
    );

    expect(refs.fullMessage.textContent).toContain('This conversation has ended');
  });

  it('shows a notice', () => {
    showShell(refs, build([{ type: 'notice', text: 'A fresh start.' }]));

    expect(refs.notice.textContent).toBe('A fresh start.');
    expect(refs.notice.hidden).toBe(false);
  });

  it('shows New conversation for a conversation that was restored with turns', () => {
    showShell(
      refs,
      build([
        {
          type: 'restored',
          transcript: /** @type {any} */ ({
            ...makeConversation(),
            turns: [
              {
                turn: 1,
                question: 'q',
                detailLevel: 'default',
                status: 'answered',
                answer: makeAnswer(),
              },
            ],
          }),
          roleDepth: 1,
        },
      ]),
    );

    expect(refs.newConversation.hidden).toBe(false);
  });
});

describe('showRoleConfirm', () => {
  it('asks to start a new conversation as the role, and says the current one will end', () => {
    showRoleConfirm(refs, 'Developer');

    expect(refs.roleConfirm.hidden).toBe(false);
    expect(refs.roleConfirmText.textContent).toBe(
      'Start a new conversation as Developer? The current conversation will end.',
    );
  });

  it('hides the question', () => {
    showRoleConfirm(refs, 'Developer');

    showRoleConfirm(refs, undefined);

    expect(refs.roleConfirm.hidden).toBe(true);
    expect(refs.roleConfirmText.textContent).toBe('');
  });
});
