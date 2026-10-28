// @vitest-environment jsdom
// @ts-check
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../public/js/api.js';
import { createChat } from '../../public/js/chat.js';
import { SIGN_IN_REQUIRED } from '../../public/js/signIn.js';
import { FETCHED_AT, loadPage, makeAnswer, makeConversation } from '../helpers/page.js';

const ID = '11111111-2222-4333-8444-555555555555';
const ROLES = [{ id: 'po', displayName: 'Product Owner', description: 'Owns it.', depth: 1 }];

/** @type {import('../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
  document.documentElement.lang = 'en';
  document.title = 'Role-Aware Knowledge Assistant';
});

/**
 * Starts the real page with a fake server that has a sign-in.
 * @param {{ signedIn: boolean, refuseFollowUp?: boolean }} options - Whether someone is signed in, and whether the second question is refused.
 * @returns {Promise<void>} Resolves once the page is drawn.
 */
async function start({ signedIn, refuseFollowUp = false }) {
  let calls = 0;
  const chat = createChat({
    refs,
    api: /** @type {any} */ ({
      fetchRoles: async () => ROLES,
      fetchAuthStatus: async () => ({ mode: 'oauth', signedIn, siteHost: 'acme.atlassian.net' }),
      signOut: async () => ({ signedOut: true, revoked: true }),
      createConversation: async () => ({ conversationId: ID, maxTurns: 5 }),
      sendMessage: vi.fn(async ({ onEvent }) => {
        calls += 1;
        if (refuseFollowUp && calls > 1) {
          throw new ApiError('Sign in with Atlassian to keep going.', 401, SIGN_IN_REQUIRED);
        }
        onEvent({
          event: 'done',
          data: { ...makeAnswer(), conversation: makeConversation({ role: 'po' }) },
        });
      }),
      fetchConversation: async () => ({ ...makeConversation({ role: 'po' }), turns: [] }),
      deleteConversation: async () => undefined,
      recheckAnswer: async () => ({ updates: [] }),
      sendFeedback: async () => undefined,
    }),
    storage: {
      loadRole: () => 'po',
      saveRole: () => undefined,
      loadConversationId: () => undefined,
      saveConversationId: () => undefined,
      clearConversationId: () => undefined,
    },
    clock: { now: () => FETCHED_AT },
  });
  await chat.start();
}

/**
 * Types a question and sends it.
 * @param {string} text - The question.
 * @returns {Promise<void>} Resolves once the page has settled.
 */
async function ask(text) {
  const field = /** @type {HTMLTextAreaElement} */ (document.getElementById('question'));
  field.value = text;
  /** @type {HTMLFormElement} */ (field.closest('form')).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Checks the page with axe. Colour contrast needs a real browser, so it is left to Lighthouse.
 * @returns {Promise<string[]>} One line for each violation.
 */
async function violations() {
  const results = await axe.run(document, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return results.violations.map(
    ({ id, help, nodes }) =>
      `${id}: ${help} (${nodes.map((node) => node.target.join(' ')).join('; ')})`,
  );
}

describe('the sign-in screens have no accessibility violations that axe can find', () => {
  it('on the sign-in screen', async () => {
    await start({ signedIn: false });

    expect(refs.welcome.querySelector('.sign-in')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('with the signed-in panel in the sidebar', async () => {
    await start({ signedIn: true });
    await ask('How do refunds work?');

    expect(refs.sidebar.querySelector('.signed-in')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('with the expired banner in place of the question box', async () => {
    await start({ signedIn: true, refuseFollowUp: true });
    await ask('How do refunds work?');
    await ask('And after 30 days?');

    expect(refs.end.querySelector('.expired-banner')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });
});
