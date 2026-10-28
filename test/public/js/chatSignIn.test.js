// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../public/js/api.js';
import { createChat } from '../../../public/js/chat.js';
import { SIGN_IN_REQUIRED } from '../../../public/js/signIn.js';
import { FETCHED_AT, loadPage, makeAnswer, makeConversation } from '../../helpers/page.js';

const ID = '11111111-2222-4333-8444-555555555555';
const ROLES = [{ id: 'dev', displayName: 'Developer', description: 'Writes the code.', depth: 3 }];
const SIGNED_IN = Object.freeze({ mode: 'oauth', signedIn: true, siteHost: 'acme.atlassian.net' });
const SIGNED_OUT = Object.freeze({ mode: 'oauth', signedIn: false });

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
});

/**
 * What the server sends when a turn is answered.
 * @returns {{ event: string, data: any }} The event.
 */
function done() {
  return {
    event: 'done',
    data: { ...makeAnswer(), conversation: makeConversation({ role: 'dev' }) },
  };
}

/** The refusal of a question for want of a sign-in. */
const refused = () => new ApiError('Sign in with Atlassian to keep going.', 401, SIGN_IN_REQUIRED);

/**
 * A chat on the real page with a fake server that has a sign-in.
 * @param {object} [options] - What differs from the usual.
 * @param {Record<string, any>} [options.api] - Replacements for parts of the fake server.
 * @param {string} [options.storedConversation] - A conversation id the tab remembers.
 * @returns {Promise<{ api: Record<string, import('vitest').Mock>, storage: Record<string, import('vitest').Mock> }>} The fakes.
 */
async function setup({ api: replace = {}, storedConversation } = {}) {
  const api = {
    fetchRoles: vi.fn(async () => ROLES),
    fetchAuthStatus: vi.fn(async () => SIGNED_IN),
    signOut: vi.fn(async () => ({ signedOut: true, revoked: true })),
    createConversation: vi.fn(async () => ({ conversationId: ID, maxTurns: 5 })),
    sendMessage: vi.fn(async ({ onEvent }) => [done()].forEach(onEvent)),
    fetchConversation: vi.fn(async () => ({
      ...makeConversation({ role: 'dev', turnCount: 1 }),
      turns: [
        {
          turn: 1,
          question: 'Q?',
          detailLevel: 'default',
          status: 'answered',
          answer: makeAnswer(),
        },
      ],
    })),
    deleteConversation: vi.fn(async () => undefined),
    recheckAnswer: vi.fn(async () => ({ updates: [], ignored: false })),
    sendFeedback: vi.fn(async () => undefined),
    ...replace,
  };
  const storage = {
    loadRole: vi.fn(() => undefined),
    saveRole: vi.fn(),
    loadConversationId: vi.fn(() => storedConversation),
    saveConversationId: vi.fn(),
    clearConversationId: vi.fn(),
  };
  const chat = createChat({
    refs,
    api: /** @type {any} */ (api),
    storage: /** @type {any} */ (storage),
    clock: { now: () => FETCHED_AT },
  });
  await chat.start();
  return { api, storage };
}

/**
 * Lets everything that is waiting to happen happen.
 * @returns {Promise<void>} Resolves when the page has been quiet for a moment.
 */
async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Types a question and sends it.
 * @param {string} text - The question.
 * @returns {Promise<void>} Resolves when the page has settled.
 */
async function ask(text) {
  const field = /** @type {HTMLTextAreaElement} */ (document.getElementById('question'));
  field.value = text;
  /** @type {HTMLFormElement} */ (field.closest('form')).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
  await settle();
}

/** @returns {HTMLFormElement} The question form. */
const composer = () => /** @type {HTMLFormElement} */ (refs.composer.querySelector('form'));

describe('the page in oauth mode when nobody is signed in', () => {
  it('shows the sign-in screen instead of the welcome, with the roles and the question box hidden', async () => {
    await setup({ api: { fetchAuthStatus: vi.fn(async () => SIGNED_OUT) } });

    expect(refs.welcome.querySelector('.sign-in')).not.toBeNull();
    expect(refs.welcome.textContent).not.toContain('What would you like to know?');
    expect(refs.sidebar.querySelector('[data-role]')).toBeNull();
    expect(refs.sidebar.querySelector('.brand')).not.toBeNull();
    expect(refs.sidebar.querySelector('.signed-in')).toBeNull();
    expect(composer().hidden).toBe(true);
  });
});

describe('the page in oauth mode when someone is signed in', () => {
  it('shows the welcome, the roles and the signed-in panel', async () => {
    await setup();

    expect(refs.welcome.querySelector('.sign-in')).toBeNull();
    expect(refs.sidebar.querySelector('[data-role]')).not.toBeNull();
    expect(refs.sidebar.querySelector('.signed-in')?.textContent).toContain(
      'Signed in to acme.atlassian.net',
    );
    expect(composer().hidden).toBe(false);
  });

  it('shows the sign-in screen when starting the conversation is refused', async () => {
    await setup({ api: { createConversation: vi.fn(async () => Promise.reject(refused())) } });

    await ask('How do refunds work?');

    expect(refs.welcome.querySelector('.sign-in')).not.toBeNull();
    expect(refs.notice.hidden).toBe(true);
    expect(refs.live.textContent).toBe('Your Atlassian sign-in has expired.');
  });

  it('shows the expired banner in place of the question box when a follow-up is refused', async () => {
    let calls = 0;
    await setup({
      api: {
        sendMessage: vi.fn(async ({ onEvent }) => {
          calls += 1;
          if (calls > 1) {
            throw refused();
          }
          [done()].forEach(onEvent);
        }),
      },
    });
    await ask('How do refunds work?');

    await ask('And after 30 days?');

    const banner = refs.end.querySelector('.expired-banner');
    expect(banner?.textContent).toContain('Your Atlassian sign-in has expired.');
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/auth/atlassian/start');
    expect(composer().hidden).toBe(true);
    expect(refs.sidebar.querySelector('.signed-in')).toBeNull();
    expect(refs.live.textContent).toBe('Your Atlassian sign-in has expired.');
  });

  it('keeps the refused turn but offers no Try again until the person signs in again', async () => {
    let calls = 0;
    await setup({
      api: {
        sendMessage: vi.fn(async ({ onEvent }) => {
          calls += 1;
          if (calls > 1) {
            throw refused();
          }
          [done()].forEach(onEvent);
        }),
      },
    });
    await ask('How do refunds work?');

    await ask('And after 30 days?');

    expect(refs.messages.children).toHaveLength(2);
    expect(refs.messages.querySelector('[data-action="retry"]')).toBeNull();
  });

  it('shows the expired banner when the sign-in runs out while a question is answered', async () => {
    await setup({
      api: {
        sendMessage: vi.fn(async ({ onEvent }) =>
          onEvent({
            event: 'error',
            data: {
              kind: 'signin',
              message: 'Your Atlassian sign-in has expired. Sign in again to keep going.',
            },
          }),
        ),
      },
    });

    await ask('How do refunds work?');

    expect(refs.end.querySelector('.expired-banner')).not.toBeNull();
  });

  it('keeps the end card over the banner when the conversation has ended anyway', async () => {
    await setup({
      storedConversation: ID,
      api: {
        fetchAuthStatus: vi.fn(async () => SIGNED_OUT),
        fetchConversation: vi.fn(async () => ({
          ...makeConversation({ role: 'dev', turnCount: 1, ended: 'signed-out' }),
          turns: [
            {
              turn: 1,
              question: 'Q?',
              detailLevel: 'default',
              status: 'answered',
              answer: makeAnswer(),
            },
          ],
        })),
      },
    });

    expect(refs.end.textContent).toContain('You signed out');
    expect(refs.end.querySelector('.expired-banner')).toBeNull();
  });

  it('restores a conversation after signing in again, as a reload would', async () => {
    await setup({ storedConversation: ID });

    expect(refs.messages.children).toHaveLength(1);
    expect(refs.end.querySelector('.expired-banner')).toBeNull();
    expect(composer().hidden).toBe(false);
  });
});

describe('signing out', () => {
  /**
   * Clicks Sign out.
   * @returns {Promise<void>} Resolves when the page has settled.
   */
  async function clickSignOut() {
    /** @type {HTMLButtonElement} */ (
      refs.sidebar.querySelector('[data-action="sign-out"]')
    ).click();
    await settle();
  }

  it('signs out, forgets the conversation, says "Signed out" and shows the sign-in screen', async () => {
    const { api, storage } = await setup();
    await ask('How do refunds work?');

    await clickSignOut();

    expect(api.signOut).toHaveBeenCalledOnce();
    expect(storage.clearConversationId).toHaveBeenCalled();
    expect(refs.messages.children).toHaveLength(0);
    expect(refs.welcome.querySelector('.sign-in')).not.toBeNull();
    expect(document.querySelector('.toast')?.textContent).toBe('Signed out');
    expect(refs.live.textContent).toBe('Signed out');
  });

  it('says so, and stays signed in, when signing out fails', async () => {
    await setup({ api: { signOut: vi.fn(async () => Promise.reject(new Error('down'))) } });

    await clickSignOut();

    expect(refs.notice.textContent).toBe('Signing out did not work. Please try again.');
    expect(refs.sidebar.querySelector('.signed-in')).not.toBeNull();
  });
});

describe('a server without a sign-in', () => {
  it('shows neither the sign-in screen nor the panel', async () => {
    await setup({ api: { signOut: undefined, fetchAuthStatus: undefined } });

    expect(refs.sidebar.querySelector('.signed-in')).toBeNull();
    expect(refs.welcome.querySelector('.sign-in')).toBeNull();
  });

  it('ignores a Sign out click when it cannot sign out', async () => {
    await setup({ api: { signOut: undefined } });

    /** @type {HTMLButtonElement} */ (
      refs.sidebar.querySelector('[data-action="sign-out"]')
    ).click();
    await settle();

    expect(refs.sidebar.querySelector('.signed-in')).not.toBeNull();
  });

  it('says when the sign-in status could not be read, and carries on', async () => {
    await setup({ api: { fetchAuthStatus: vi.fn(async () => Promise.reject(new Error('down'))) } });

    expect(refs.notice.textContent).toBe(
      'Whether you are signed in to Atlassian could not be checked.',
    );
    expect(refs.sidebar.querySelector('[data-role]')).not.toBeNull();
  });
});
