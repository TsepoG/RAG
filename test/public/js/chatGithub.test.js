// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../public/js/api.js';
import { createChat } from '../../../public/js/chat.js';
import { GITHUB_SIGN_IN_REQUIRED } from '../../../public/js/signIn.js';
import { FETCHED_AT, loadPage, makeAnswer, makeConversation } from '../../helpers/page.js';

const ID = '11111111-2222-4333-8444-555555555555';
const ROLES = [{ id: 'dev', displayName: 'Developer', description: 'Writes the code.', depth: 3 }];
const LOGGED_IN = Object.freeze({ mode: 'gh-cli', signedIn: true, login: 'TsepoG' });
const LOGGED_OUT = Object.freeze({ mode: 'gh-cli', signedIn: false, reason: 'logged-out' });

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

/**
 * The refusal of a question because the GitHub CLI has no token.
 * @param {string} reason - Why.
 * @returns {ApiError} The error the page sees.
 */
const refused = (reason) =>
  new ApiError("GitHub CLI isn't logged in.", 401, GITHUB_SIGN_IN_REQUIRED, reason);

/**
 * A chat on the real page with a fake server in gh-cli mode.
 * @param {Record<string, any>} [replace] - Replacements for parts of the fake server.
 * @returns {Promise<Record<string, import('vitest').Mock>>} The fake server.
 */
async function setup(replace = {}) {
  const api = {
    fetchRoles: vi.fn(async () => ROLES),
    fetchAuthStatus: vi.fn(async () => ({ mode: 'basic', signedIn: true, github: LOGGED_IN })),
    checkGithub: vi.fn(async () => ({ mode: 'basic', signedIn: true, github: LOGGED_IN })),
    signOut: vi.fn(),
    createConversation: vi.fn(async () => ({ conversationId: ID, maxTurns: 5 })),
    sendMessage: vi.fn(async ({ onEvent }) => [done()].forEach(onEvent)),
    fetchConversation: vi.fn(async () => ({ ...makeConversation({ role: 'dev' }), turns: [] })),
    deleteConversation: vi.fn(async () => undefined),
    recheckAnswer: vi.fn(async () => ({ updates: [], ignored: false })),
    sendFeedback: vi.fn(async () => undefined),
    ...replace,
  };
  const chat = createChat({
    refs,
    api: /** @type {any} */ (api),
    storage: /** @type {any} */ ({
      loadRole: vi.fn(),
      saveRole: vi.fn(),
      loadConversationId: vi.fn(),
      saveConversationId: vi.fn(),
      clearConversationId: vi.fn(),
    }),
    clock: { now: () => FETCHED_AT },
  });
  await chat.start();
  return api;
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

/**
 * Presses Check again.
 * @returns {Promise<void>} Resolves when the page has settled.
 */
async function checkAgain() {
  /** @type {HTMLButtonElement} */ (document.querySelector('[data-action="check-github"]')).click();
  await settle();
}

/** @returns {HTMLFormElement} The question form. */
const composer = () => /** @type {HTMLFormElement} */ (refs.composer.querySelector('form'));

describe('the page in gh-cli mode', () => {
  it('names the GitHub account in the panel, with no Sign out for a service-account Atlassian', async () => {
    await setup();

    const panel = refs.sidebar.querySelector('.signed-in');
    expect(panel?.textContent).toBe('GitHub: TsepoG (GitHub CLI)');
    expect(panel?.querySelector('[data-action="sign-out"]')).toBeNull();
  });

  it('shows the GitHub sign-in screen first when the CLI has no token, with the roles and question box hidden', async () => {
    await setup({
      fetchAuthStatus: vi.fn(async () => ({ mode: 'basic', signedIn: true, github: LOGGED_OUT })),
    });

    expect(refs.welcome.querySelector('#github-sign-in-heading')?.textContent).toBe(
      "GitHub CLI isn't logged in.",
    );
    expect(refs.welcome.querySelector('#sign-in-heading')).toBeNull();
    expect(refs.sidebar.querySelector('[data-role]')).toBeNull();
    expect(refs.sidebar.querySelector('.signed-in')).toBeNull();
    expect(composer().hidden).toBe(true);
  });

  it('shows both sign-in parts when Atlassian and GitHub both need attention', async () => {
    await setup({
      fetchAuthStatus: vi.fn(async () => ({ mode: 'oauth', signedIn: false, github: LOGGED_OUT })),
    });

    expect(refs.welcome.querySelector('#sign-in-heading')).not.toBeNull();
    expect(refs.welcome.querySelector('#github-sign-in-heading')).not.toBeNull();
  });

  it('shows the GitHub banner when a follow-up is refused, keeping the turn without Try again', async () => {
    let calls = 0;
    await setup({
      sendMessage: vi.fn(async ({ onEvent }) => {
        calls += 1;
        if (calls > 1) {
          throw refused('sso');
        }
        [done()].forEach(onEvent);
      }),
    });
    await ask('Which tags does the code try?');

    await ask('And where is that list?');

    const banner = refs.end.querySelector('.expired-banner');
    expect(banner?.querySelector('h2')?.textContent).toBe(
      'GitHub needs your organisation authorised.',
    );
    expect(banner?.querySelector('code')?.textContent).toBe('gh auth refresh -h github.com');
    expect(composer().hidden).toBe(true);
    expect(refs.messages.children).toHaveLength(2);
    expect(refs.messages.querySelector('[data-action="retry"]')).toBeNull();
    expect(refs.live.textContent).toBe('GitHub needs your organisation authorised.');
  });

  it('shows the GitHub sign-in screen when starting the conversation is refused', async () => {
    await setup({ createConversation: vi.fn(async () => Promise.reject(refused('cli-missing'))) });

    await ask('Which tags does the code try?');

    expect(refs.welcome.querySelector('#github-sign-in-heading')?.textContent).toBe(
      'GitHub CLI not found.',
    );
  });

  it('brings the question box back, with the conversation, when Check again finds a token', async () => {
    let calls = 0;
    const api = await setup({
      sendMessage: vi.fn(async ({ onEvent }) => {
        calls += 1;
        if (calls === 2) {
          throw refused('logged-out');
        }
        [done()].forEach(onEvent);
      }),
    });
    await ask('Which tags does the code try?');
    await ask('And where is that list?');

    await checkAgain();

    expect(api.checkGithub).toHaveBeenCalledOnce();
    expect(refs.end.querySelector('.expired-banner')).toBeNull();
    expect(composer().hidden).toBe(false);
    expect(refs.messages.children).toHaveLength(2);
    expect(refs.live.textContent).toBe('GitHub CLI is logged in.');
    expect(refs.sidebar.querySelector('.signed-in')?.textContent).toContain('TsepoG');
  });

  it('keeps the banner, with the new reason, when Check again still finds no token', async () => {
    await setup({
      fetchAuthStatus: vi.fn(async () => ({ mode: 'basic', signedIn: true, github: LOGGED_OUT })),
      checkGithub: vi.fn(async () => ({
        mode: 'basic',
        signedIn: true,
        github: { mode: 'gh-cli', signedIn: false, reason: 'sso' },
      })),
    });

    await checkAgain();

    expect(refs.welcome.querySelector('#github-sign-in-heading')?.textContent).toBe(
      'GitHub needs your organisation authorised.',
    );
    expect(refs.live.textContent).toBe('GitHub needs your organisation authorised.');
  });

  it('says so when Check again cannot reach the server', async () => {
    await setup({
      fetchAuthStatus: vi.fn(async () => ({ mode: 'basic', signedIn: true, github: LOGGED_OUT })),
      checkGithub: vi.fn(async () => Promise.reject(new Error('down'))),
    });

    await checkAgain();

    expect(refs.notice.textContent).toBe('The GitHub CLI could not be checked. Please try again.');
  });

  it('shows the banner, then asks for the reason, when the token stops working mid-answer', async () => {
    const api = await setup({
      sendMessage: vi.fn(async ({ onEvent }) =>
        onEvent({ event: 'error', data: { kind: 'github-signin', message: 'x' } }),
      ),
    });
    api.fetchAuthStatus.mockResolvedValue({
      mode: 'basic',
      signedIn: true,
      github: { mode: 'gh-cli', signedIn: false, reason: 'sso' },
    });

    await ask('Which tags does the code try?');

    expect(api.fetchAuthStatus).toHaveBeenCalledTimes(2);
    expect(refs.end.querySelector('.expired-banner h2')?.textContent).toBe(
      'GitHub needs your organisation authorised.',
    );
  });

  it('keeps the banner it has when the reason cannot be read', async () => {
    const api = await setup({
      sendMessage: vi.fn(async ({ onEvent }) =>
        onEvent({ event: 'error', data: { kind: 'github-signin', message: 'x' } }),
      ),
    });
    api.fetchAuthStatus.mockRejectedValue(new Error('down'));

    await ask('Which tags does the code try?');

    expect(refs.end.querySelector('.expired-banner h2')?.textContent).toBe(
      "GitHub CLI isn't logged in.",
    );
  });
});

describe('a status that says nothing about GitHub', () => {
  it('leaves the banner as it is after the token stops working mid-answer', async () => {
    const api = await setup({
      sendMessage: vi.fn(async ({ onEvent }) =>
        onEvent({ event: 'error', data: { kind: 'github-signin', message: 'x' } }),
      ),
    });
    api.fetchAuthStatus.mockResolvedValue({ mode: 'basic', signedIn: true });

    await ask('Which tags does the code try?');

    expect(refs.end.querySelector('.expired-banner h2')?.textContent).toBe(
      "GitHub CLI isn't logged in.",
    );
  });
});

describe('the page without Check again', () => {
  it('ignores a Check again click when the server offers none', async () => {
    await setup({
      fetchAuthStatus: vi.fn(async () => ({ mode: 'basic', signedIn: true, github: LOGGED_OUT })),
      checkGithub: undefined,
    });

    await checkAgain();

    expect(refs.welcome.querySelector('#github-sign-in-heading')).not.toBeNull();
  });

  it('shows nothing about GitHub in token mode', async () => {
    await setup({
      fetchAuthStatus: vi.fn(async () => ({
        mode: 'basic',
        signedIn: true,
        github: { mode: 'token', signedIn: true },
      })),
    });

    expect(refs.sidebar.querySelector('.signed-in')).toBeNull();
    expect(document.body.textContent).not.toContain('GitHub CLI');
  });
});
