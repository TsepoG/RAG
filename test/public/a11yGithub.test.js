// @vitest-environment jsdom
// @ts-check
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../public/js/api.js';
import { createChat } from '../../public/js/chat.js';
import { GITHUB_SIGN_IN_REQUIRED } from '../../public/js/signIn.js';
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
 * Starts the real page with a fake server in gh-cli mode.
 * @param {{ atlassian: 'basic' | 'oauth-signed-out', github: Record<string, unknown>, refuseFollowUp?: boolean }} options -
 *   The Atlassian state, the GitHub state, and whether the second question is refused.
 * @returns {Promise<void>} Resolves once the page is drawn.
 */
async function start({ atlassian, github, refuseFollowUp = false }) {
  let calls = 0;
  const status =
    atlassian === 'basic'
      ? { mode: 'basic', signedIn: true, github }
      : { mode: 'oauth', signedIn: false, github };
  const chat = createChat({
    refs,
    api: /** @type {any} */ ({
      fetchRoles: async () => ROLES,
      fetchAuthStatus: async () => status,
      checkGithub: async () => status,
      createConversation: async () => ({ conversationId: ID, maxTurns: 5 }),
      sendMessage: vi.fn(async ({ onEvent }) => {
        calls += 1;
        if (refuseFollowUp && calls > 1) {
          throw new ApiError('x', 401, GITHUB_SIGN_IN_REQUIRED, 'logged-out');
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

const LOGGED_OUT = { mode: 'gh-cli', signedIn: false, reason: 'logged-out' };
const LOGGED_IN = { mode: 'gh-cli', signedIn: true, login: 'TsepoG' };

describe('the GitHub CLI screens have no accessibility violations that axe can find', () => {
  it('on the GitHub sign-in screen', async () => {
    await start({ atlassian: 'basic', github: LOGGED_OUT });

    expect(refs.welcome.querySelector('#github-sign-in-heading')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('on the sign-in screen with both Atlassian and GitHub to do', async () => {
    await start({ atlassian: 'oauth-signed-out', github: LOGGED_OUT });

    expect(refs.welcome.querySelectorAll('.sign-in')).toHaveLength(2);
    expect(await violations()).toEqual([]);
  });

  it('with the GitHub line in the signed-in panel', async () => {
    await start({ atlassian: 'basic', github: LOGGED_IN });
    await ask('How do refunds work?');

    expect(refs.sidebar.querySelector('.signed-in')?.textContent).toContain('TsepoG');
    expect(await violations()).toEqual([]);
  });

  it('with the GitHub banner in place of the question box', async () => {
    await start({ atlassian: 'basic', github: LOGGED_IN, refuseFollowUp: true });
    await ask('How do refunds work?');
    await ask('And after 30 days?');

    expect(refs.end.querySelector('#github-banner-title')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });
});
