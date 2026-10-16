// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../public/js/api.js';
import { AGE_REFRESH_MS, createChat, FRESH_START } from '../../../public/js/chat.js';
import { CONVERSATION_GONE } from '../../../public/js/chatState.js';
import { chip, FETCHED_AT, loadPage, makeAnswer, makeConversation } from '../../helpers/page.js';

const ID = '11111111-2222-4333-8444-555555555555';
const MINUTE = 60_000;
const ROLES = [
  { id: 'dev', displayName: 'Developer', description: 'Writes the code.', depth: 3 },
  {
    id: 'po',
    displayName: 'Product Owner',
    description: 'Owns the product.',
    depth: 1,
    suggestedQuestions: [
      'In plain terms, what does Shortlist do?',
      'Can we trust the backtest yet?',
    ],
  },
];

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
});

/**
 * What the server sends when a turn is answered.
 * @param {Record<string, any>} [answer] - Changes to the answer.
 * @param {Record<string, any>} [conversation] - Changes to where the conversation stands.
 * @returns {{ event: string, data: any }} The event.
 */
function done(answer = {}, conversation = {}) {
  return {
    event: 'done',
    data: {
      ...makeAnswer(answer),
      conversation: makeConversation({ role: 'dev', ...conversation }),
    },
  };
}

/**
 * A chat on the real page with a fake server. `turns` says what each message gets back.
 * @param {object} [options] - What differs from the usual.
 * @param {Array<Array<{ event: string, data: unknown }> | Error>} [options.turns] - The events (or the error) each message gets.
 * @param {string} [options.storedConversation] - A conversation id the tab remembers.
 * @param {string} [options.storedRole] - The role remembered.
 * @param {Record<string, any>} [options.api] - Replacements for parts of the fake server.
 * @param {{ writeText: (text: string) => Promise<void> }} [options.clipboard] - A clipboard.
 * @returns {Promise<{ chat: ReturnType<typeof createChat>, api: Record<string, import('vitest').Mock>, storage: Record<string, import('vitest').Mock>, time: { value: number } }>} The chat and its fakes.
 */
async function setup({
  turns = [[done()]],
  storedConversation,
  storedRole,
  api: replace = {},
  clipboard,
} = {}) {
  let message = 0;
  const time = { value: FETCHED_AT };
  const api = {
    fetchRoles: vi.fn(async () => ROLES),
    createConversation: vi.fn(async () => ({ conversationId: ID, maxTurns: 5 })),
    sendMessage: vi.fn(async ({ onEvent }) => {
      const turn = turns[Math.min(message, turns.length - 1)];
      message += 1;
      if (turn instanceof Error) {
        throw turn;
      }
      turn.forEach(onEvent);
    }),
    fetchConversation: vi.fn(async () => ({ ...makeConversation({ turnCount: 1 }), turns: [] })),
    deleteConversation: vi.fn(async () => undefined),
    recheckAnswer: vi.fn(async () => ({ updates: [], ignored: false })),
    sendFeedback: vi.fn(async () => undefined),
    ...replace,
  };
  const storage = {
    loadRole: vi.fn(() => storedRole),
    saveRole: vi.fn(),
    loadConversationId: vi.fn(() => storedConversation),
    saveConversationId: vi.fn(),
    clearConversationId: vi.fn(),
  };
  const chat = createChat({
    refs,
    api: /** @type {any} */ (api),
    storage: /** @type {any} */ (storage),
    clock: { now: () => time.value },
    clipboard,
  });
  await chat.start();
  return { chat, api, storage, time };
}

/**
 * Lets everything that is waiting to happen happen, as the browser would between two clicks.
 * @returns {Promise<void>} Resolves when the page has been quiet for a moment.
 */
async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** @returns {HTMLTextAreaElement} The question box. */
const field = () => /** @type {HTMLTextAreaElement} */ (document.getElementById('question'));

/** @returns {HTMLFormElement} The question form. */
const form = () => /** @type {HTMLFormElement} */ (field().closest('form'));

/**
 * Sends what is typed in the box, the way a press of Enter does.
 * @param {string} text - The question.
 */
function submit(text) {
  field().value = text;
  form().dispatchEvent(new Event('submit', { cancelable: true }));
}

/**
 * Types a question and sends it.
 * @param {string} text - The question.
 * @returns {Promise<void>} Resolves when the browser has had a chance to act.
 */
async function ask(text) {
  submit(text);
  await settle();
}

/**
 * Clicks something inside the conversation.
 * @param {string} selector - What to click.
 * @returns {Promise<void>} Resolves when the browser has had a chance to act.
 */
async function click(selector) {
  /** @type {HTMLElement} */ (refs.messages.querySelector(selector)).click();
  await settle();
}

/**
 * The questions shown in the conversation.
 * @returns {string[]} The texts.
 */
function questions() {
  return [...refs.messages.querySelectorAll('.bubble__text')].map(
    ({ textContent }) => textContent?.replace('You asked: ', '') ?? '',
  );
}

/**
 * Finds something in the sidebar.
 * @param {string} selector - What to find.
 * @returns {HTMLElement} It.
 */
const inSidebar = (selector) => /** @type {HTMLElement} */ (refs.sidebar.querySelector(selector));

/**
 * The words of the box about the conversation.
 * @returns {string} Its text.
 */
const box = () => inSidebar('.conversation-box').textContent ?? '';

/**
 * A button that is not part of the page, put in a place to check that stray clicks do nothing.
 * @param {HTMLElement} place - Where to put it.
 * @param {Record<string, string>} attributes - Its attributes.
 * @returns {HTMLButtonElement} The button.
 */
function forged(place, attributes) {
  const button = document.createElement('button');
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, value);
  }
  place.append(button);
  return button;
}

describe('starting', () => {
  it('offers the roles as buttons and chooses the one remembered', async () => {
    await setup({ storedRole: 'po' });

    const buttons = [...refs.sidebar.querySelectorAll('.roles button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Developer', 'Product Owner']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(refs.mobileBar.querySelector('.strip__role')?.textContent).toBe('Product Owner');
  });

  it.each([undefined, 'gone'])('chooses the first role when %j was remembered', async (stored) => {
    await setup({ storedRole: stored });

    expect(inSidebar('.roles button[aria-pressed="true"]').textContent).toBe('Developer');
  });

  it('shows the welcome screen, and the questions to try for the chosen role', async () => {
    await setup({ storedRole: 'po' });

    expect(refs.welcome.hidden).toBe(false);
    expect(refs.welcome.querySelector('h2')?.textContent).toBe('What would you like to know?');
    expect([...refs.welcome.querySelectorAll('.suggestion')].map((s) => s.textContent)).toEqual(
      ROLES[1].suggestedQuestions,
    );
  });

  it('shows no questions to try for a role that has none', async () => {
    await setup({ storedRole: 'dev' });

    expect(refs.welcome.querySelector('.suggestions')).toBeNull();
  });

  it('draws the question box with its label, the Ask button and how many questions fit', async () => {
    await setup();

    expect(document.querySelector('label[for="question"]')?.textContent).toBe('Your question');
    expect(document.querySelector('.composer__send')?.textContent).toBe('Ask');
    expect(document.querySelector('.composer__note')?.textContent).toBe(
      'Up to 5 questions per conversation',
    );
  });

  it('says why the roles could not be loaded', async () => {
    await setup({
      api: {
        fetchRoles: vi.fn(async () => {
          throw new ApiError('The server could not be reached.');
        }),
      },
    });

    expect(refs.notice.textContent).toBe('The server could not be reached.');
    expect(refs.notice.hidden).toBe(false);
  });

  it('says it for a failure that is not the server’s', async () => {
    await setup({
      api: {
        fetchRoles: vi.fn(async () => {
          throw new Error('odd');
        }),
      },
    });

    expect(refs.notice.textContent).toBe('The roles could not be loaded.');
  });

  it('gives the question box a label', async () => {
    await setup();

    expect(document.querySelector(`label[for="${field().id}"]`)).not.toBeNull();
  });
});

describe('choosing a role', () => {
  it('remembers it, and shows the questions to try for it', async () => {
    const { storage } = await setup({ storedRole: 'dev' });

    inSidebar('[data-role="po"]').click();

    expect(storage.saveRole).toHaveBeenCalledWith('po');
    expect(inSidebar('[data-role="po"]').getAttribute('aria-pressed')).toBe('true');
    expect(refs.welcome.querySelectorAll('.suggestion')).toHaveLength(2);
    expect(refs.mobileBar.querySelector('.strip__role')?.textContent).toBe('Product Owner');
  });

  it('keeps focus on the role that was chosen', async () => {
    await setup({ storedRole: 'dev' });
    inSidebar('[data-role="po"]').focus();

    inSidebar('[data-role="po"]').click();

    expect(document.activeElement?.getAttribute('data-role')).toBe('po');
  });

  it('does not move focus to a role when it was on something else in the sidebar', async () => {
    await setup({ storedRole: 'dev' });
    await ask('How?');
    inSidebar('[data-action="new-conversation"]').click();
    await settle();
    /** @type {HTMLElement} */ (refs.sidebar.querySelector('.drawer__close')).focus();

    inSidebar('[data-role="po"]').click();

    expect(document.activeElement?.getAttribute('data-role') ?? null).toBeNull();
  });

  it('loses focus quietly when the role it was on is no longer there', async () => {
    await setup({ storedRole: 'dev' });
    inSidebar('[data-role="po"]').focus();

    await ask('How?');

    expect(questions()).toEqual(['How?']);
  });

  it('starts the conversation as the role chosen', async () => {
    const { api } = await setup({ storedRole: 'dev' });
    inSidebar('[data-role="po"]').click();

    await ask('How?');

    expect(api.createConversation).toHaveBeenCalledExactlyOnceWith('po');
  });

  it('is locked once the first question is asked: only that role is shown, with a lock', async () => {
    await setup();
    await ask('How?');

    expect(refs.sidebar.querySelectorAll('.roles button')).toHaveLength(0);
    expect(inSidebar('.role-option--locked').textContent).toContain('Developer');
    expect(inSidebar('.roles__note').textContent).toBe(
      'Role is locked for this conversation. Changing it starts a new one.',
    );
    expect(refs.mobileBar.querySelector('.strip__role')?.textContent).toBe('Developer');
  });

  it('cannot be changed under a conversation, even by a stray click', async () => {
    const { storage } = await setup();
    await ask('How?');

    forged(refs.sidebar, { 'data-role': 'po' }).click();

    expect(storage.saveRole).not.toHaveBeenCalled();
    expect(inSidebar('.role-option--locked').textContent).toContain('Developer');
  });

  it('ignores a role that is not on offer', async () => {
    const { storage } = await setup();

    forged(refs.sidebar, { 'data-role': 'nobody' }).click();

    expect(storage.saveRole).not.toHaveBeenCalled();
  });

  it('comes back after New conversation, with the welcome screen', async () => {
    await setup();
    await ask('How?');

    inSidebar('[data-action="new-conversation"]').click();
    await settle();

    expect(refs.sidebar.querySelectorAll('.roles button')).toHaveLength(2);
    expect(refs.welcome.hidden).toBe(false);
  });
});

describe('the welcome questions', () => {
  it('put the question in the box and move the cursor there, without sending it', async () => {
    const { api } = await setup({ storedRole: 'po' });

    /** @type {HTMLElement} */ (refs.welcome.querySelector('.suggestion')).click();

    expect(field().value).toBe('In plain terms, what does Shortlist do?');
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(field().value.length);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.createConversation).not.toHaveBeenCalled();
  });

  it('are hidden once a question is asked', async () => {
    await setup({ storedRole: 'po' });

    await ask('How?');

    expect(refs.welcome.hidden).toBe(true);
  });
});

describe('a conversation of several questions', () => {
  it('starts the conversation with the first question, as the chosen role, and remembers it for the tab', async () => {
    const { api, storage } = await setup();

    await ask('How do refunds work?');

    expect(api.createConversation).toHaveBeenCalledExactlyOnceWith('dev');
    expect(storage.saveConversationId).toHaveBeenCalledWith(ID);
    expect(api.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: ID,
        question: 'How do refunds work?',
        detailLevel: 'default',
        reaskAnswerId: undefined,
      }),
    );
  });

  it('shows the question, the answer card and the turn, empties the box and puts the cursor back in it', async () => {
    await setup();

    await ask('How do refunds work?');

    expect(questions()).toEqual(['How do refunds work?']);
    expect(refs.messages.querySelector('.card .answer-card__text')?.textContent).toContain(
      'Refunds are allowed',
    );
    expect(box()).toContain('Turn 1 of 5');
    expect(refs.mobileBar.querySelector('.strip__turn')?.textContent).toBe('Turn 1 of 5');
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
  });

  it('says Ask a follow-up and Send after the first question, with the turns left', async () => {
    await setup();

    await ask('How?');

    expect(document.querySelector('label[for="question"]')?.textContent).toBe('Ask a follow-up');
    expect(document.querySelector('.composer__send')?.textContent).toBe('Send');
    expect(document.querySelector('.composer__note')?.textContent).toBe(
      '4 turns left in this conversation',
    );
  });

  it('announces the answer to screen readers', async () => {
    await setup();

    await ask('How?');

    expect(refs.live.textContent).toBe(
      'Answer ready. Mostly confirmed. Part of this is my reading.',
    );
  });

  it('asks a follow-up in the same conversation, and each answer has its own Sources', async () => {
    const { api } = await setup({
      turns: [
        [done({ answerId: 'a1', turn: 1 }, { turnCount: 1 })],
        [done({ answerId: 'a2', turn: 2 }, { turnCount: 2 })],
      ],
    });

    await ask('One');
    await ask('Two');

    expect(api.createConversation).toHaveBeenCalledOnce();
    expect(api.sendMessage.mock.calls.map(([call]) => call.conversationId)).toEqual([ID, ID]);
    expect(questions()).toEqual(['One', 'Two']);
    expect(box()).toContain('Turn 2 of 5');
    expect(
      [...refs.messages.querySelectorAll('section.sources')].map((section) =>
        section.getAttribute('data-answer-id'),
      ),
    ).toEqual(['a1', 'a2']);
  });

  it('counts the sources used, once, across the answers', async () => {
    await setup({
      turns: [
        [done({ answerId: 'a1', turn: 1 }, { turnCount: 1 })],
        [done({ answerId: 'a2', turn: 2 }, { turnCount: 2 })],
      ],
    });

    await ask('One');
    await ask('Two');

    expect(box()).toContain('Sources used2');
  });

  it('shows the steps and the draft while the answer is coming, turns the box off and offers Stop', async () => {
    /** @type {(event: { event: string, data: unknown }) => void} */
    let emit = vi.fn();
    /** @type {() => void} */
    let finish = () => undefined;
    await setup({
      api: {
        sendMessage: vi.fn(
          ({ onEvent }) =>
            new Promise((resolve) => {
              emit = onEvent;
              finish = () => resolve(undefined);
            }),
        ),
      },
    });
    submit('How?');
    await vi.waitFor(() =>
      expect(document.querySelector('.composer__stop')?.hasAttribute('hidden')).toBe(false),
    );

    emit({ event: 'progress', data: { message: 'Searching Confluence…' } });
    emit({ event: 'token', data: { text: 'Refunds' } });

    const rows = [...refs.messages.querySelectorAll('.progress__step')].map(
      (row) => row.querySelector('.progress__label')?.textContent,
    );
    expect(rows).toEqual(['Searched Confluence', 'Writing and checking the answer']);
    expect(refs.messages.querySelector('.progress__draft-text')?.textContent).toBe('Refunds');
    expect(field().disabled).toBe(true);
    expect(document.querySelector('.composer__send')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.composer__note')?.textContent).toBe(
      'Most answers take 1–3 minutes',
    );
    finish();
  });

  it('does not send a blank question', async () => {
    const { api } = await setup();

    submit('   ');
    await Promise.resolve();

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.createConversation).not.toHaveBeenCalled();
  });

  it('sends on Enter, not on Shift+Enter', async () => {
    const { api } = await setup();
    field().value = 'How?';
    const sent = vi.fn((/** @type {Event} */ event) => event.preventDefault());
    form().addEventListener('submit', sent);

    field().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }),
    );
    expect(sent).not.toHaveBeenCalled();
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));

    expect(sent).toHaveBeenCalledOnce();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('says the conversation could not be started', async () => {
    const { api } = await setup({
      api: {
        createConversation: vi.fn(async () => {
          throw new ApiError('The server could not be reached.');
        }),
      },
    });

    await ask('How?');

    expect(refs.notice.textContent).toBe('The server could not be reached.');
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(questions()).toEqual([]);
  });

  it('says it too for a failure that is not the server’s', async () => {
    await setup({
      api: {
        createConversation: vi.fn(async () => {
          throw new Error('odd');
        }),
      },
    });

    await ask('How?');

    expect(refs.notice.textContent).toBe('The conversation could not be started.');
  });

  it('does nothing before the roles are loaded', async () => {
    const { api } = await setup({ api: { fetchRoles: vi.fn(async () => []) } });

    await ask('How?');

    expect(api.createConversation).not.toHaveBeenCalled();
  });
});

describe('citation chips', () => {
  it('open the Sources of their own answer and move focus to the source', async () => {
    await setup({
      turns: [
        [
          done({
            answerId: 'a1',
            html: { answer: `<p>See ${chip('C1')}.</p>`, conflicts: [] },
          }),
        ],
      ],
    });
    await ask('How?');

    /** @type {HTMLElement} */ (refs.messages.querySelector('button.cite')).click();

    expect(refs.messages.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(document.activeElement?.id).toBe('source-a1-C1');
  });

  it('keep the Sources open when the page is drawn again', async () => {
    const { api } = await setup({
      turns: [
        [done({ answerId: 'a1', html: { answer: `<p>See ${chip('C1')}.</p>`, conflicts: [] } })],
      ],
    });
    await ask('How?');
    /** @type {HTMLElement} */ (refs.messages.querySelector('button.cite')).click();
    api.recheckAnswer.mockResolvedValue({
      updates: [makeAnswer({ changedKeys: ['C1'] })],
      ignored: false,
    });

    await click('[data-action="recheck"]');

    expect(refs.messages.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('leave the Sources as they were when the source is not in the answer', async () => {
    await setup({
      turns: [[done({ html: { answer: `<p>See ${chip('C9')}.</p>`, conflicts: [] } })]],
    });
    await ask('How?');

    /** @type {HTMLElement} */ (refs.messages.querySelector('button.cite')).click();

    expect(refs.messages.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});

describe('the Sources toggle', () => {
  it('opens and closes the list, and the page remembers it when it is drawn again', async () => {
    const { api } = await setup();
    await ask('How?');
    const toggle = () =>
      /** @type {HTMLElement} */ (refs.messages.querySelector('.sources__toggle'));

    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    api.recheckAnswer.mockResolvedValue({ updates: [makeAnswer({ changedKeys: ['C1'] })] });
    await click('[data-action="recheck"]');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await click('[data-action="recheck"]');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('re-checking an answer', () => {
  it('asks the server, and shows "checked" beside each source that was the same', async () => {
    const { api, time } = await setup();
    await ask('How?');
    api.recheckAnswer.mockResolvedValue({
      updates: [
        makeAnswer({
          sourceStates: [
            {
              key: 'C1',
              fetchedInTurn: 1,
              fetchedAt: FETCHED_AT,
              changed: false,
              check: { status: 'unchanged', checkedAt: FETCHED_AT },
            },
          ],
        }),
      ],
      ignored: false,
    });
    time.value = FETCHED_AT + 2 * MINUTE;

    await click('[data-action="recheck"]');

    expect(api.recheckAnswer).toHaveBeenCalledExactlyOnceWith(ID, 'a1');
    expect(refs.messages.querySelector('.source-status--checked')?.textContent).toBe(
      '✓ checked 2 min ago',
    );
  });

  it('shows "changed since this answer", the changed box and a re-ask when a source changed', async () => {
    const { api } = await setup();
    await ask('How?');
    api.recheckAnswer.mockResolvedValue({
      updates: [
        makeAnswer({
          changedKeys: ['C1'],
          result: { confidence: 'medium' },
          rendered: { level: 'medium', banner: 'Mostly confirmed.' },
          sourceStates: [
            {
              key: 'C1',
              fetchedInTurn: 1,
              fetchedAt: FETCHED_AT,
              changed: true,
              check: { status: 'changed', checkedAt: FETCHED_AT },
            },
          ],
        }),
      ],
    });

    await click('[data-action="recheck"]');

    expect(refs.messages.querySelector('.source-status--changed')?.textContent).toBe(
      'Changed since this answer',
    );
    expect(refs.messages.querySelector('.notice--changed')).not.toBeNull();
    expect(refs.messages.querySelector('[data-action="reask"]')?.textContent).toBe(
      'Re-ask with the latest version',
    );
  });

  it('says so when the check was asked for too soon after the last', async () => {
    const { api } = await setup();
    await ask('How?');
    api.recheckAnswer.mockResolvedValue({ updates: [makeAnswer()], ignored: true });

    await click('[data-action="recheck"]');

    expect(refs.notice.textContent).toContain('checked a moment ago');
  });

  it('shows the button as busy while the check runs, and does not start a second', async () => {
    /** @type {(value: unknown) => void} */
    let finish = vi.fn();
    const { api } = await setup();
    await ask('How?');
    api.recheckAnswer.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    /** @type {HTMLElement} */ (refs.messages.querySelector('[data-action="recheck"]')).click();
    const busy = /** @type {HTMLElement} */ (
      refs.messages.querySelector('[data-action="recheck"]')
    );
    busy.click();

    expect(busy.textContent).toBe('Checking…');
    expect(api.recheckAnswer).toHaveBeenCalledOnce();
    finish({ updates: [] });
    await vi.waitFor(() =>
      expect(refs.messages.querySelector('[data-action="recheck"]')?.textContent).toBe(
        'Re-check sources',
      ),
    );
  });

  it('applies the check the server runs by itself after an answer', async () => {
    await setup({
      turns: [
        [
          done(),
          {
            event: 'recheck',
            data: {
              updates: [
                makeAnswer({
                  sourceStates: [
                    {
                      key: 'C1',
                      fetchedInTurn: 1,
                      fetchedAt: FETCHED_AT,
                      changed: false,
                      check: { status: 'unavailable', checkedAt: FETCHED_AT },
                    },
                  ],
                }),
              ],
              conversation: makeConversation({ role: 'dev' }),
            },
          },
        ],
      ],
    });

    await ask('How?');

    expect(refs.messages.querySelector('.source-status--unavailable')?.textContent).toBe(
      "Couldn't check",
    );
  });

  it('says the conversation has ended when the server no longer has it', async () => {
    const { api } = await setup();
    await ask('How?');
    api.recheckAnswer.mockRejectedValue(new ApiError('gone', 404, 'conversation_ended'));

    await click('[data-action="recheck"]');

    expect(refs.notice.textContent).toBe(CONVERSATION_GONE);
  });

  it.each([
    [
      new ApiError('Other checks are running. Please try again in a moment.', 429, 'recheck_busy'),
      'Other checks are running. Please try again in a moment.',
    ],
    [new Error('odd'), 'The sources could not be checked just now.'],
  ])('says why a check could not be made', async (failure, text) => {
    const { api } = await setup();
    await ask('How?');
    api.recheckAnswer.mockRejectedValue(failure);

    await click('[data-action="recheck"]');

    expect(refs.notice.textContent).toBe(text);
  });
});

describe('re-asking, asking for more detail, and trying again', () => {
  it('re-asks the same question as a new turn, naming the answer so the server finds the changed sources', async () => {
    const { api } = await setup({
      turns: [
        [done({ changedKeys: ['C1'] })],
        [done({ answerId: 'a2', turn: 2 }, { turnCount: 2 })],
      ],
    });
    await ask('How do refunds work?');

    await click('[data-action="reask"]');

    expect(api.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: 'How do refunds work?',
        detailLevel: 'default',
        reaskAnswerId: 'a1',
      }),
    );
    expect(questions()).toEqual(['How do refunds work?', 'How do refunds work?']);
    expect(box()).toContain('Turn 2 of 5');
  });

  it('asks for more detail as a follow-up at the next level', async () => {
    const { api } = await setup({
      turns: [[done({}, { roleDepth: 1 })], [done({ answerId: 'a2', turn: 2 })]],
    });
    await ask('How do refunds work?');

    await click('[data-action="more"]');

    expect(api.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'How do refunds work?', detailLevel: 'more' }),
    );
    expect(refs.messages.textContent).toContain('Asked for more detail.');
  });

  it('tries a failed question again, as a new turn', async () => {
    const { api } = await setup({ turns: [new Error('odd'), [done({ answerId: 'a2', turn: 2 })]] });
    await ask('How?');

    await click('[data-action="retry"]');

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ question: 'How?', detailLevel: 'default' }),
    );
    expect(refs.messages.querySelector('.answer-card--answered')).not.toBeNull();
  });

  it('does nothing for a Try again button whose turn is gone', async () => {
    const { api } = await setup();
    await ask('How?');

    forged(refs.messages, { 'data-action': 'retry', 'data-turn': '99' }).click();
    await settle();

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it.each(['reask', 'more'])(
    'does nothing for a %s button whose answer is no longer there',
    async (action) => {
      const { api } = await setup();
      await ask('How?');

      forged(refs.messages, { 'data-action': action, 'data-answer-id': 'gone' }).click();
      await settle();

      expect(api.sendMessage).toHaveBeenCalledOnce();
    },
  );

  it('does nothing for a button with an action it does not know', async () => {
    const { api } = await setup();
    await ask('How?');

    forged(refs.messages, { 'data-action': 'bogus', 'data-answer-id': 'a1' }).click();
    await settle();

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it('does nothing for a click that did not start on an element', async () => {
    const { api } = await setup();
    await ask('How?');
    const text = /** @type {HTMLElement} */ (refs.messages.querySelector('.bubble__text'))
      .lastChild;

    text?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it('does nothing for a click on something that is not a button of an answer', async () => {
    const { api } = await setup();
    await ask('How?');

    /** @type {HTMLElement} */ (refs.messages.querySelector('.bubble')).click();
    refs.messages.click();

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });
});

describe('stopping', () => {
  it('stops the turn that is running, keeps the draft, and lets the conversation go on', async () => {
    /** @type {AbortSignal | undefined} */
    let signal;
    /** @type {(event: { event: string, data: unknown }) => void} */
    let emit = vi.fn();
    const sendMessage = vi.fn(
      ({ onEvent, signal: given }) =>
        new Promise((_resolve, reject) => {
          signal = given;
          emit = onEvent;
          given.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const { api } = await setup({ api: { sendMessage } });
    submit('How?');
    await vi.waitFor(() =>
      expect(document.querySelector('.composer__stop')?.hasAttribute('hidden')).toBe(false),
    );
    emit({ event: 'token', data: { text: 'half' } });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(api.fetchConversation).toHaveBeenCalled());

    expect(signal?.aborted).toBe(true);
    expect(refs.messages.querySelector('.answer-card__notice')?.textContent).toContain('Stopped.');
    expect(refs.messages.querySelector('.answer-card__draft')?.textContent).toBe('half');
    expect(field().disabled).toBe(false);
  });

  it('stops with the Stop button too', async () => {
    /** @type {AbortSignal | undefined} */
    let signal;
    await setup({
      api: {
        sendMessage: vi.fn(
          ({ signal: given }) =>
            new Promise((_resolve, reject) => {
              signal = given;
              given.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      },
    });
    submit('How?');
    await vi.waitFor(() =>
      expect(document.querySelector('.composer__stop')?.hasAttribute('hidden')).toBe(false),
    );

    /** @type {HTMLElement} */ (document.querySelector('.composer__stop')).click();
    await settle();

    expect(signal?.aborted).toBe(true);
  });

  it('ignores Escape and the Stop button when nothing is running', async () => {
    const { api } = await setup();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    /** @type {HTMLElement} */ (document.querySelector('.composer__stop')).click();

    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

describe('when a question fails', () => {
  it('shows the server’s message for a refusal, with Try again, and catches up on where the conversation stands', async () => {
    const { api } = await setup({
      turns: [
        new ApiError(
          'The conversation is still answering the last question.',
          429,
          'conversation_busy',
        ),
      ],
    });

    await ask('How?');

    expect(refs.messages.querySelector('.answer-card__error')?.textContent).toBe(
      'The conversation is still answering the last question.',
    );
    expect(refs.messages.querySelector('.pill')?.textContent).toBe('Something went wrong');
    expect(refs.messages.querySelector('[data-action="retry"]')).not.toBeNull();
    expect(api.fetchConversation).toHaveBeenCalledWith(ID);
  });

  it('says something went wrong for a failure that is not the server’s', async () => {
    await setup({ turns: [new Error('odd')] });

    await ask('How?');

    expect(refs.messages.querySelector('.answer-card__error')?.textContent).toBe(
      'Something went wrong.',
    );
  });

  it('says the conversation has ended when the server says so, and shows the end card in place of the box', async () => {
    await setup({
      turns: [new ApiError('gone', 404, 'conversation_ended')],
      api: {
        fetchConversation: vi.fn(async () => {
          throw new ApiError('gone', 404, 'conversation_ended');
        }),
      },
    });

    await ask('How?');

    expect(refs.notice.textContent).toBe(CONVERSATION_GONE);
    expect(form().hidden).toBe(true);
    expect(refs.end.querySelector('h2')?.textContent).toBe('This conversation has expired');
    expect(refs.messages.querySelector('[data-action="retry"]')).toBeNull();
  });

  it('shows an error event from the stream, and the end of the conversation it brings', async () => {
    await setup({
      api: {
        fetchConversation: vi.fn(async () => ({
          ...makeConversation({ role: 'dev', ended: 'session-error' }),
          turns: [],
        })),
      },
      turns: [
        [
          {
            event: 'error',
            data: {
              kind: 'copilot',
              message: 'Copilot could not answer just now. Please try again.',
              conversation: makeConversation({ role: 'dev', ended: 'session-error' }),
            },
          },
        ],
      ],
    });

    await ask('How?');
    await settle();

    expect(refs.messages.querySelector('.answer-card__error')?.textContent).toContain(
      'Copilot could not answer',
    );
    expect(refs.end.querySelector('h2')?.textContent).toBe('The assistant lost this conversation');
  });

  it('fails a stream that closed before it was answered', async () => {
    await setup({ turns: [[{ event: 'progress', data: { message: 'x' } }]] });

    await ask('How?');

    expect(refs.messages.querySelector('.answer-card__error')?.textContent).toContain(
      'connection closed',
    );
  });

  it('ignores an event it does not know', async () => {
    await setup({ turns: [[{ event: 'surprise', data: {} }, done()]] });

    await ask('How?');

    expect(refs.messages.querySelector('.card')).not.toBeNull();
  });

  it('loses nothing when the catch-up read fails', async () => {
    await setup({
      turns: [new Error('odd')],
      api: { fetchConversation: vi.fn(async () => Promise.reject(new Error('down'))) },
    });

    await ask('How?');

    expect(questions()).toEqual(['How?']);
  });

  it('tells the reader when the catch-up finds the conversation gone', async () => {
    await setup({
      turns: [new Error('odd')],
      api: {
        fetchConversation: vi.fn(async () => {
          throw new ApiError('gone', 404, 'conversation_ended');
        }),
      },
    });

    await ask('How?');

    expect(refs.notice.textContent).toBe(CONVERSATION_GONE);
  });
});

describe('the end of a conversation', () => {
  const FULL = [
    [
      done(
        {},
        {
          turnCount: 5,
          full: 'turns',
          fullMessage: 'This conversation is full — start a new one to keep going.',
        },
      ),
    ],
  ];

  it('shows the end card in place of the question box, and offers no more detail', async () => {
    await setup({ turns: FULL });

    await ask('The last one');

    expect(form().hidden).toBe(true);
    expect(refs.end.querySelector('h2')?.textContent).toBe(
      'This conversation has reached its 5 questions',
    );
    expect(refs.end.textContent).toContain('Checks on 2 sources: 2 not checked');
    expect(refs.messages.querySelector('[data-action="more"]')).toBeNull();
    expect(box()).toContain('5 of 5 · ended');
  });

  it('moves focus to the end card, because there is no box to go back to', async () => {
    await setup({ turns: FULL });

    await ask('The last one');

    expect(document.activeElement).toBe(refs.end.querySelector('h2'));
  });

  it('offers Start a new conversation and Copy, and not the sidebar buttons', async () => {
    await setup({ turns: FULL });

    await ask('The last one');

    expect([...refs.end.querySelectorAll('button')].map(({ textContent }) => textContent)).toEqual([
      'Start a new conversation',
      'Copy this conversation',
    ]);
    expect(refs.sidebar.querySelectorAll('.conversation-box button')).toHaveLength(0);
  });

  it('starts a new conversation from the end card, and takes the card away', async () => {
    const { api } = await setup({ turns: FULL });
    await ask('The last one');

    /** @type {HTMLElement} */ (refs.end.querySelector('[data-action="new-conversation"]')).click();
    await settle();

    expect(api.deleteConversation).toHaveBeenCalledWith(ID);
    expect(refs.end.children).toHaveLength(0);
    expect(form().hidden).toBe(false);
    expect(questions()).toEqual([]);
  });

  it('keeps the end card as it is when nothing about it changed', async () => {
    await setup({ turns: FULL });
    await ask('The last one');
    const card = refs.end.firstElementChild;

    refs.sidebar.dispatchEvent(new Event('noop'));
    /** @type {HTMLElement} */ (refs.messages.querySelector('[data-action="recheck"]')).click();
    await settle();

    expect(refs.end.firstElementChild).toBe(card);
  });
});

describe('a new conversation', () => {
  it('ends the old one on the server, forgets it, clears the page and puts the cursor in the box', async () => {
    const { api, storage } = await setup();
    await ask('How?');

    inSidebar('[data-action="new-conversation"]').click();
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(ID));

    expect(storage.clearConversationId).toHaveBeenCalled();
    expect(questions()).toEqual([]);
    expect(refs.welcome.hidden).toBe(false);
    expect(refs.sidebar.querySelector('.conversation-box')).toBeNull();
    expect(refs.live.textContent).toBe('');
    expect(document.activeElement).toBe(field());
  });

  it('carries on when the old conversation is already gone', async () => {
    const { api } = await setup({
      api: { deleteConversation: vi.fn(async () => Promise.reject(new ApiError('gone', 404))) },
    });
    await ask('How?');

    inSidebar('[data-action="new-conversation"]').click();
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalled());

    expect(questions()).toEqual([]);
  });

  it('stops a question that is running first', async () => {
    /** @type {AbortSignal | undefined} */
    let signal;
    const { api } = await setup({
      api: {
        sendMessage: vi.fn(
          ({ signal: given }) =>
            new Promise((_resolve, reject) => {
              signal = given;
              given.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      },
    });
    submit('How?');
    await vi.waitFor(() =>
      expect(document.querySelector('.composer__stop')?.hasAttribute('hidden')).toBe(false),
    );

    forged(refs.sidebar, { 'data-action': 'new-conversation' }).click();
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalled());

    expect(signal?.aborted).toBe(true);
  });

  it('only clears the page when there was no conversation on the server', async () => {
    const { api } = await setup();

    forged(refs.sidebar, { 'data-action': 'new-conversation' }).click();
    await Promise.resolve();

    expect(api.deleteConversation).not.toHaveBeenCalled();
  });

  it('is not offered while a question runs', async () => {
    await setup({
      api: { sendMessage: vi.fn(() => new Promise(() => undefined)) },
    });
    submit('How?');
    await vi.waitFor(() => expect(refs.sidebar.querySelector('.conversation-box')).not.toBeNull());

    expect(refs.sidebar.querySelectorAll('.conversation-box button')).toHaveLength(0);
  });
});

describe('reloading', () => {
  const transcript = {
    ...makeConversation({ turnCount: 2, role: 'po' }),
    turns: [
      {
        turn: 1,
        question: 'One',
        detailLevel: 'default',
        status: 'answered',
        answer: makeAnswer({ answerId: 'a1' }),
      },
      {
        turn: 2,
        question: 'Two',
        detailLevel: 'default',
        status: 'answered',
        answer: makeAnswer({ answerId: 'a2', turn: 2 }),
      },
    ],
  };

  it('shows the conversation the tab had open, and its role, locked', async () => {
    const { api } = await setup({
      storedConversation: ID,
      api: { fetchConversation: vi.fn(async () => transcript) },
    });

    expect(api.fetchConversation).toHaveBeenCalledWith(ID);
    expect(questions()).toEqual(['One', 'Two']);
    expect(box()).toContain('Turn 2 of 5');
    expect(inSidebar('.role-option--locked').textContent).toContain('Product Owner');
    expect(refs.notice.hidden).toBe(true);
    expect(refs.welcome.hidden).toBe(true);
  });

  it('carries on in the conversation it restored', async () => {
    const { api } = await setup({
      storedConversation: ID,
      turns: [[done({ answerId: 'a3', turn: 3 }, { turnCount: 3, role: 'po' })]],
      api: { fetchConversation: vi.fn(async () => transcript) },
    });

    await ask('Three');

    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: ID }));
    expect(questions()).toEqual(['One', 'Two', 'Three']);
  });

  it('starts fresh, with a notice, when the server no longer has the conversation', async () => {
    const { storage } = await setup({
      storedConversation: ID,
      api: {
        fetchConversation: vi.fn(async () => {
          throw new ApiError('gone', 404, 'conversation_ended');
        }),
      },
    });

    expect(refs.notice.textContent).toBe(FRESH_START);
    expect(storage.clearConversationId).toHaveBeenCalled();
    expect(questions()).toEqual([]);
    expect(form().hidden).toBe(false);
    expect(refs.welcome.hidden).toBe(false);
  });

  it('keeps the stored conversation when the server could not be reached', async () => {
    const { storage } = await setup({
      storedConversation: ID,
      api: { fetchConversation: vi.fn(async () => Promise.reject(new ApiError('down'))) },
    });

    expect(storage.clearConversationId).not.toHaveBeenCalled();
    expect(refs.notice.hidden).toBe(true);
  });

  it('shows a conversation whose role is not offered any more', async () => {
    await setup({
      storedConversation: ID,
      api: { fetchConversation: vi.fn(async () => ({ ...transcript, role: 'gone' })) },
    });

    expect(questions()).toEqual(['One', 'Two']);
  });
});

describe('feedback', () => {
  it('sends a thumbs up at once and says it was saved', async () => {
    const { api } = await setup();
    await ask('How?');

    await click('[data-action="up"]');

    expect(api.sendFeedback).toHaveBeenCalledExactlyOnceWith({ answerId: 'a1', rating: 'up' });
    expect(refs.messages.querySelector('.feedback__message')?.textContent).toBe(
      'Thank you. Your feedback was saved.',
    );
    expect(
      /** @type {HTMLButtonElement} */ (refs.messages.querySelector('[data-action="up"]')).disabled,
    ).toBe(true);
  });

  it('opens a form after a thumbs down, and sends the comment and the source named', async () => {
    const { api } = await setup();
    await ask('How?');

    await click('[data-action="down"]');
    expect(api.sendFeedback).not.toHaveBeenCalled();
    const feedback = /** @type {HTMLFormElement} */ (
      refs.messages.querySelector('form.feedback-form')
    );
    /** @type {HTMLTextAreaElement} */ (feedback.elements.namedItem('comment')).value =
      '  Wrong window  ';
    /** @type {HTMLSelectElement} */ (feedback.elements.namedItem('source')).value = 'C1';
    feedback.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.sendFeedback).toHaveBeenCalled());

    expect(api.sendFeedback).toHaveBeenCalledExactlyOnceWith({
      answerId: 'a1',
      rating: 'down',
      comment: 'Wrong window',
      wrongSourceKey: 'C1',
    });
  });

  it('sends only what was filled in', async () => {
    const { api } = await setup();
    await ask('How?');
    await click('[data-action="down"]');

    refs.messages
      .querySelector('form.feedback-form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.sendFeedback).toHaveBeenCalled());

    expect(api.sendFeedback).toHaveBeenCalledWith({ answerId: 'a1', rating: 'down' });
  });

  it.each([
    [
      new ApiError('That answer is no longer remembered.', 404),
      'That answer is no longer remembered.',
    ],
    [new Error('odd'), 'It could not be sent.'],
  ])('says why feedback could not be sent, and lets it be tried again', async (failure, text) => {
    const { api } = await setup();
    await ask('How?');
    api.sendFeedback.mockRejectedValue(failure);

    await click('[data-action="up"]');

    expect(refs.messages.querySelector('.feedback__message')?.textContent).toBe(text);
    expect(
      /** @type {HTMLButtonElement} */ (refs.messages.querySelector('[data-action="up"]')).disabled,
    ).toBe(false);
  });

  it('ignores a form submit that is not a feedback form', async () => {
    const { api } = await setup();
    await ask('How?');

    refs.messages.dispatchEvent(new Event('submit', { cancelable: true }));
    refs.messages.querySelector('li')?.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(api.sendFeedback).not.toHaveBeenCalled();
  });
});

describe('Copy this conversation', () => {
  /** @returns {{ writeText: import('vitest').Mock }} A clipboard that works. */
  const working = () => ({ writeText: vi.fn(async () => undefined) });

  it('puts the whole conversation on the clipboard as markdown, and says so', async () => {
    const clipboard = working();
    await setup({ clipboard });
    await ask('How do refunds work?');

    inSidebar('[data-action="copy-conversation"]').click();
    await settle();

    expect(clipboard.writeText).toHaveBeenCalledOnce();
    const markdown = /** @type {string} */ (clipboard.writeText.mock.calls[0][0]);
    expect(markdown).toContain('# Conversation as Developer, 2026-10-13');
    expect(markdown).toContain('> How do refunds work?');
    expect(markdown).toContain('Refunds are allowed for 30 days [C1].');
    expect(refs.live.textContent).toBe('Conversation copied');
  });

  it('shows a message on screen that it was copied, which goes away by itself', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await setup({ clipboard: working() });
    await ask('How?');
    const toast = () => /** @type {HTMLElement} */ (document.querySelector('.toast'));
    expect(toast().hidden).toBe(true);

    inSidebar('[data-action="copy-conversation"]').click();
    await settle();

    expect(toast().hidden).toBe(false);
    expect(toast().textContent).toBe('Conversation copied');
    const [hide] = /** @type {[() => void, number]} */ (
      timers.mock.calls.find(([, delay]) => delay === 3000)
    );
    hide();
    expect(toast().hidden).toBe(true);
    timers.mockRestore();
  });

  it('shows no message that it was copied when it could not be, because the box is shown instead', async () => {
    await setup({
      clipboard: {
        writeText: vi.fn(async () => {
          throw new DOMException('Not allowed', 'NotAllowedError');
        }),
      },
    });
    await ask('How?');

    inSidebar('[data-action="copy-conversation"]').click();
    await settle();

    expect(/** @type {HTMLElement} */ (document.querySelector('.toast')).hidden).toBe(true);
    expect(document.querySelector('.copy-dialog')).not.toBeNull();
  });

  it('shows the text to copy by hand when the clipboard refuses, and gives focus back when it is closed', async () => {
    await setup({
      clipboard: {
        writeText: vi.fn(async () => {
          throw new DOMException('Not allowed', 'NotAllowedError');
        }),
      },
    });
    await ask('How?');
    const button = inSidebar('[data-action="copy-conversation"]');
    button.focus();

    button.click();
    await settle();

    const dialog = /** @type {HTMLElement} */ (document.querySelector('.copy-dialog'));
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog.querySelector('textarea'));
    expect(/** @type {HTMLTextAreaElement} */ (dialog.querySelector('textarea')).value).toContain(
      '# Conversation as Developer',
    );
    expect(refs.live.textContent).toBe('The conversation is shown so that you can copy it.');

    /** @type {HTMLElement} */ (dialog.querySelector('button')).click();

    expect(document.querySelector('.copy-dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('is also offered by the end card', async () => {
    const clipboard = working();
    await setup({
      clipboard,
      turns: [[done({}, { turnCount: 5, full: 'turns', fullMessage: 'Full.' })]],
    });
    await ask('The last one');

    /** @type {HTMLElement} */ (
      refs.end.querySelector('[data-action="copy-conversation"]')
    ).click();
    await settle();

    expect(clipboard.writeText).toHaveBeenCalledOnce();
  });

  it('names an unknown role rather than failing', async () => {
    const clipboard = working();
    await setup({
      clipboard,
      storedConversation: ID,
      api: {
        fetchConversation: vi.fn(async () => ({
          ...makeConversation({ turnCount: 1, role: 'gone' }),
          turns: [
            {
              turn: 1,
              question: 'One',
              detailLevel: 'default',
              status: 'answered',
              answer: makeAnswer(),
            },
          ],
        })),
      },
    });

    forged(refs.sidebar, { 'data-action': 'copy-conversation' }).click();
    await settle();

    expect(clipboard.writeText.mock.calls[0][0]).toContain('# Conversation as Unknown role');
  });
});

describe('the drawer on a phone', () => {
  it('opens from the menu button and closes on Escape, without stopping anything', async () => {
    const { api } = await setup();
    const menu = /** @type {HTMLElement} */ (refs.mobileBar.querySelector('.topbar__menu'));

    menu.click();
    expect(refs.sidebar.classList.contains('is-open')).toBe(true);
    expect(refs.backdrop.hidden).toBe(false);
    refs.sidebar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(refs.sidebar.classList.contains('is-open')).toBe(false);
    expect(document.activeElement).toBe(menu);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('closes with its own Close button', async () => {
    await setup();
    /** @type {HTMLElement} */ (refs.mobileBar.querySelector('.topbar__menu')).click();

    /** @type {HTMLElement} */ (refs.sidebar.querySelector('.drawer__close')).click();

    expect(refs.sidebar.classList.contains('is-open')).toBe(false);
  });

  it('closes when a role is chosen, and when New conversation is pressed', async () => {
    await setup({ storedRole: 'dev' });
    const menu = /** @type {HTMLElement} */ (refs.mobileBar.querySelector('.topbar__menu'));

    menu.click();
    inSidebar('[data-role="po"]').click();
    expect(refs.sidebar.classList.contains('is-open')).toBe(false);

    await ask('How?');
    menu.click();
    inSidebar('[data-action="new-conversation"]').click();
    await settle();
    expect(refs.sidebar.classList.contains('is-open')).toBe(false);
  });

  it('keeps the strip up to date with the role and the turn', async () => {
    await setup();
    await ask('How?');

    expect(refs.mobileBar.querySelector('.strip')?.textContent).toBe('DeveloperTurn 1 of 5');
  });
});

describe('stray clicks', () => {
  it('do nothing when they are on something that is not a role or a button', async () => {
    const { api, storage } = await setup();

    refs.sidebar
      .querySelector('.roles__note')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const text = document.createTextNode('text');
    refs.sidebar.append(text);
    text.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(storage.saveRole).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

describe('the clock', () => {
  it('brings the time beside the sources up to date, every half minute', async () => {
    const { chat, api, time } = await setup();
    await ask('How?');
    api.recheckAnswer.mockResolvedValue({
      updates: [
        makeAnswer({
          sourceStates: [
            {
              key: 'C1',
              fetchedInTurn: 1,
              fetchedAt: FETCHED_AT,
              changed: false,
              check: { status: 'unchanged', checkedAt: FETCHED_AT },
            },
          ],
        }),
      ],
    });
    await click('[data-action="recheck"]');
    time.value = FETCHED_AT + 4 * MINUTE;

    chat.tick();

    expect(refs.messages.querySelector('.source-status--checked')?.textContent).toBe(
      '✓ checked 4 min ago',
    );
    expect(AGE_REFRESH_MS).toBe(30_000);
  });

  it('exposes the state it draws from', async () => {
    const { chat } = await setup();
    await ask('How?');

    expect(chat.state().turns).toHaveLength(1);
  });
});
