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
  { id: 'po', displayName: 'Product Owner', description: 'Owns the product.', depth: 1 },
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
 * A chat on the real page with a fake server. `script` says what each message gets back.
 * @param {object} [options] - What differs from the usual.
 * @param {Array<Array<{ event: string, data: unknown }> | Error>} [options.turns] - The events (or the error) each message gets.
 * @param {string} [options.storedConversation] - A conversation id the tab remembers.
 * @param {string} [options.storedRole] - The role remembered.
 * @param {Record<string, any>} [options.api] - Replacements for parts of the fake server.
 * @returns {Promise<{ chat: ReturnType<typeof createChat>, api: Record<string, import('vitest').Mock>, storage: Record<string, import('vitest').Mock>, time: { value: number } }>} The chat and its fakes.
 */
async function setup({
  turns = [[done()]],
  storedConversation,
  storedRole,
  api: replace = {},
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

/**
 * Types a question and sends it.
 * @param {string} text - The question.
 * @returns {Promise<void>} Resolves when the browser has had a chance to act.
 */
async function ask(text) {
  /** @type {HTMLTextAreaElement} */ (refs.question).value = text;
  refs.form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

/**
 * Clicks something inside the conversation.
 * @param {string} selector - What to click.
 * @returns {Promise<void>} Resolves when the browser has had a chance to act.
 */
async function click(selector) {
  const target = /** @type {HTMLElement} */ (refs.messages.querySelector(selector));
  target.click();
  await settle();
}

/**
 * The questions shown in the conversation.
 * @returns {string[]} The texts.
 */
function questions() {
  return [...refs.messages.querySelectorAll('.bubble.user .text')].map(
    ({ textContent }) => textContent ?? '',
  );
}

describe('starting', () => {
  it('offers the roles and selects the one remembered', async () => {
    await setup({ storedRole: 'po' });

    expect(/** @type {HTMLSelectElement} */ (refs.role).value).toBe('po');
    expect(refs.roleDescription.textContent).toBe('Owns the product.');
  });

  it('says why the roles could not be loaded', async () => {
    await setup({
      api: {
        fetchRoles: vi.fn(async () => {
          throw new ApiError('The server could not be reached.');
        }),
      },
    });

    expect(refs.roleDescription.textContent).toBe('The server could not be reached.');
  });

  it('says it for a failure that is not the server’s', async () => {
    await setup({
      api: {
        fetchRoles: vi.fn(async () => {
          throw new Error('odd');
        }),
      },
    });

    expect(refs.roleDescription.textContent).toBe('The roles could not be loaded.');
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

  it('shows the question, the answer card and a turn counter, empties the box and puts the cursor back in it', async () => {
    await setup();

    await ask('How do refunds work?');

    expect(questions()).toEqual(['How do refunds work?']);
    expect(refs.messages.querySelector('.card .answer')?.textContent).toContain(
      'Refunds are allowed',
    );
    expect(refs.turnCounter.textContent).toBe('Turn 1 of 5');
    expect(/** @type {HTMLTextAreaElement} */ (refs.question).value).toBe('');
    expect(document.activeElement).toBe(refs.question);
  });

  it('announces the answer to screen readers', async () => {
    await setup();

    await ask('How?');

    expect(refs.live.textContent).toBe(
      'Answer ready. Mostly confirmed. Part of this is my reading.',
    );
  });

  it('asks a follow-up in the same conversation, and each answer has its own Sources panel', async () => {
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
    expect(refs.turnCounter.textContent).toBe('Turn 2 of 5');
    expect(
      [...refs.messages.querySelectorAll('details.sources')].map((panel) =>
        panel.getAttribute('data-answer-id'),
      ),
    ).toEqual(['a1', 'a2']);
  });

  it('shows progress and the draft while the answer is coming', async () => {
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
    /** @type {HTMLTextAreaElement} */ (refs.question).value = 'How?';
    refs.form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(refs.stop.hidden).toBe(false));

    emit({ event: 'progress', data: { message: 'Searching Confluence…' } });
    emit({ event: 'token', data: { text: 'Refunds' } });

    expect(refs.messages.querySelector('output.progress')?.textContent).toBe(
      'Searching Confluence…',
    );
    expect(refs.messages.querySelector('.answer.draft')?.textContent).toBe('Refunds');
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(true);
    finish();
  });

  it('does not send a blank question, or a second one while one is running', async () => {
    const { api } = await setup();

    /** @type {HTMLTextAreaElement} */ (refs.question).value = '   ';
    refs.form.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.createConversation).not.toHaveBeenCalled();
  });

  it('sends on Enter, not on Shift+Enter', async () => {
    const { api } = await setup();
    const field = /** @type {HTMLTextAreaElement} */ (refs.question);
    field.value = 'How?';
    const submit = vi.fn((/** @type {Event} */ event) => event.preventDefault());
    refs.form.addEventListener('submit', submit);

    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }),
    );
    expect(submit).not.toHaveBeenCalled();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));

    expect(submit).toHaveBeenCalledOnce();
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
  it('open the Sources panel of their own answer and move focus to the source', async () => {
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

    const panel = /** @type {HTMLDetailsElement} */ (
      refs.messages.querySelector('details.sources')
    );
    expect(panel.open).toBe(true);
    expect(document.activeElement?.id).toBe('source-a1-C1');
  });

  it('keep a Sources panel open that the reader opened, when the page is drawn again', async () => {
    const { api } = await setup();
    await ask('How?');
    const panel = /** @type {HTMLDetailsElement} */ (
      refs.messages.querySelector('details.sources')
    );
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    api.recheckAnswer.mockResolvedValue({
      updates: [makeAnswer({ changedKeys: ['C1'] })],
      ignored: false,
    });

    await click('[data-action="recheck"]');

    expect(
      /** @type {HTMLDetailsElement} */ (refs.messages.querySelector('details.sources')).open,
    ).toBe(true);
  });

  it('forget a panel the reader closed', async () => {
    const { api } = await setup();
    await ask('How?');
    const panel = /** @type {HTMLDetailsElement} */ (
      refs.messages.querySelector('details.sources')
    );
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    panel.open = false;
    panel.dispatchEvent(new Event('toggle'));
    api.recheckAnswer.mockResolvedValue({ updates: [makeAnswer({ changedKeys: ['C1'] })] });

    await click('[data-action="recheck"]');

    expect(
      /** @type {HTMLDetailsElement} */ (refs.messages.querySelector('details.sources')).open,
    ).toBe(false);
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
    expect(refs.messages.querySelector('.check-unchanged')?.textContent).toBe(
      '✓ checked 2 min ago',
    );
  });

  it('shows "changed since this answer", caps the answer and offers a re-ask when a source changed', async () => {
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

    expect(refs.messages.querySelector('.check-changed')?.textContent).toBe(
      'changed since this answer',
    );
    expect(refs.messages.querySelector('.changed-note')).not.toBeNull();
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

    expect(refs.messages.querySelector('.check-unavailable')?.textContent).toBe("couldn't check");
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

describe('re-asking and asking for more detail', () => {
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
    expect(refs.turnCounter.textContent).toBe('Turn 2 of 5');
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

  it('does nothing for a button whose answer is no longer there', async () => {
    const { api } = await setup();
    await ask('How?');
    const button = /** @type {HTMLElement} */ (
      refs.messages.querySelector('[data-action="recheck"]')
    );
    button.setAttribute('data-action', 'reask');
    button.setAttribute('data-answer-id', 'gone');

    button.click();
    await Promise.resolve();

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it('does nothing for a more-detail button whose answer is no longer there', async () => {
    const { api } = await setup();
    await ask('How?');
    const button = /** @type {HTMLElement} */ (
      refs.messages.querySelector('[data-action="recheck"]')
    );
    button.setAttribute('data-action', 'more');
    button.setAttribute('data-answer-id', 'gone');

    button.click();
    await settle();

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it('does nothing for a click that did not start on an element', async () => {
    const { api } = await setup();
    await ask('How?');
    const text = /** @type {HTMLElement} */ (refs.messages.querySelector('.bubble .text'))
      .firstChild;

    text?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(api.sendMessage).toHaveBeenCalledOnce();
  });

  it('does not take the Also consulted list for a Sources panel when it is opened', async () => {
    const { api } = await setup();
    await ask('How?');
    const consulted = /** @type {HTMLDetailsElement} */ (
      refs.messages.querySelector('details.consulted')
    );
    consulted.open = true;
    consulted.dispatchEvent(new Event('toggle'));
    api.recheckAnswer.mockResolvedValue({ updates: [makeAnswer({ changedKeys: ['C1'] })] });

    await click('[data-action="recheck"]');

    expect(
      /** @type {HTMLDetailsElement} */ (refs.messages.querySelector('details.sources')).open,
    ).toBe(false);
  });

  it('does nothing for a click on something that is not a button of an answer', async () => {
    const { api } = await setup();
    await ask('How?');

    /** @type {HTMLElement} */ (refs.messages.querySelector('.bubble.user')).click();
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
    /** @type {HTMLTextAreaElement} */ (refs.question).value = 'How?';
    refs.form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(refs.stop.hidden).toBe(false));
    emit({ event: 'token', data: { text: 'half' } });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(api.fetchConversation).toHaveBeenCalled());

    expect(signal?.aborted).toBe(true);
    expect(refs.messages.querySelector('.notice')?.textContent).toContain('Stopped.');
    expect(refs.messages.querySelector('.answer.draft')?.textContent).toBe('half');
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(false);
  });

  it('ignores Escape and the Stop button when nothing is running', async () => {
    const { api } = await setup();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    refs.stop.click();

    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

describe('when a question fails', () => {
  it('shows the server’s message for a refusal and catches up on where the conversation stands', async () => {
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

    expect(refs.messages.querySelector('p.error')?.textContent).toBe(
      'The conversation is still answering the last question.',
    );
    expect(api.fetchConversation).toHaveBeenCalledWith(ID);
  });

  it('says something went wrong for a failure that is not the server’s', async () => {
    await setup({ turns: [new Error('odd')] });

    await ask('How?');

    expect(refs.messages.querySelector('p.error')?.textContent).toBe('Something went wrong.');
  });

  it('says the conversation has ended when the server says so, and closes the input', async () => {
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
    expect(/** @type {HTMLTextAreaElement} */ (refs.question).disabled).toBe(true);
  });

  it('shows an error event from the stream, and the state of the conversation it brings', async () => {
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

    expect(refs.messages.querySelector('p.error')?.textContent).toContain(
      'Copilot could not answer',
    );
    expect(refs.fullMessage.textContent).toContain('has ended');
  });

  it('fails a stream that closed before it was answered', async () => {
    await setup({ turns: [[{ event: 'progress', data: { message: 'x' } }]] });

    await ask('How?');

    expect(refs.messages.querySelector('p.error')?.textContent).toContain('connection closed');
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

describe('a full conversation', () => {
  it('says so under the last answer, disables the input and keeps New conversation', async () => {
    await setup({
      turns: [
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
      ],
    });

    await ask('The last one');

    expect(refs.fullMessage.textContent).toBe(
      'This conversation is full — start a new one to keep going.',
    );
    expect(/** @type {HTMLTextAreaElement} */ (refs.question).disabled).toBe(true);
    expect(refs.newConversation.hidden).toBe(false);
    expect(refs.messages.querySelector('[data-action="more"]')).toBeNull();
  });
});

describe('the role', () => {
  it('is remembered when it is changed before the first question, with no prompt', async () => {
    const { storage } = await setup();
    const select = /** @type {HTMLSelectElement} */ (refs.role);

    select.value = 'po';
    select.dispatchEvent(new Event('change'));

    expect(storage.saveRole).toHaveBeenCalledWith('po');
    expect(refs.roleConfirm.hidden).toBe(true);
    expect(refs.roleDescription.textContent).toBe('Owns the product.');
  });

  it('does nothing when it is changed before the roles are loaded', async () => {
    const { storage } = await setup({ api: { fetchRoles: vi.fn(async () => []) } });

    refs.role.dispatchEvent(new Event('change'));

    expect(storage.saveRole).not.toHaveBeenCalled();
    expect(refs.roleConfirm.hidden).toBe(true);
  });

  it('is not changed under a conversation that has questions: the reader is asked first', async () => {
    const { storage } = await setup();
    await ask('How?');
    const select = /** @type {HTMLSelectElement} */ (refs.role);

    select.value = 'po';
    select.dispatchEvent(new Event('change'));

    expect(refs.roleConfirm.hidden).toBe(false);
    expect(refs.roleConfirmText.textContent).toBe(
      'Start a new conversation as Product Owner? The current conversation will end.',
    );
    expect(storage.saveRole).not.toHaveBeenCalled();
  });

  it('goes back to the conversation’s role when the reader keeps the conversation', async () => {
    await setup();
    await ask('How?');
    const select = /** @type {HTMLSelectElement} */ (refs.role);
    select.value = 'po';
    select.dispatchEvent(new Event('change'));

    refs.roleConfirmNo.click();

    expect(refs.roleConfirm.hidden).toBe(true);
    expect(select.value).toBe('dev');
    expect(questions()).toEqual(['How?']);
  });

  it('starts a new conversation as the new role when the reader says yes', async () => {
    const { api, storage } = await setup();
    await ask('How?');
    const select = /** @type {HTMLSelectElement} */ (refs.role);
    select.value = 'po';
    select.dispatchEvent(new Event('change'));

    refs.roleConfirmYes.click();
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(ID));

    expect(storage.saveRole).toHaveBeenCalledWith('po');
    expect(select.value).toBe('po');
    expect(questions()).toEqual([]);
    expect(refs.roleConfirm.hidden).toBe(true);
    await ask('Again?');
    expect(api.createConversation).toHaveBeenLastCalledWith('po');
  });

  it('is not asked about when it is changed back to the conversation’s own role', async () => {
    await setup();
    await ask('How?');
    const select = /** @type {HTMLSelectElement} */ (refs.role);

    select.value = 'dev';
    select.dispatchEvent(new Event('change'));

    expect(refs.roleConfirm.hidden).toBe(true);
  });
});

describe('a new conversation', () => {
  it('ends the old one on the server, forgets it, clears the page and puts the cursor in the box', async () => {
    const { api, storage } = await setup();
    await ask('How?');

    refs.newConversation.click();
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith(ID));

    expect(storage.clearConversationId).toHaveBeenCalled();
    expect(questions()).toEqual([]);
    expect(refs.turnCounter.textContent).toBe('No questions yet.');
    expect(refs.live.textContent).toBe('');
    expect(document.activeElement).toBe(refs.question);
  });

  it('carries on when the old conversation is already gone', async () => {
    const { api } = await setup({
      api: { deleteConversation: vi.fn(async () => Promise.reject(new ApiError('gone', 404))) },
    });
    await ask('How?');

    refs.newConversation.click();
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
    /** @type {HTMLTextAreaElement} */ (refs.question).value = 'How?';
    refs.form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(refs.stop.hidden).toBe(false));

    refs.newConversation.click();
    await vi.waitFor(() => expect(api.deleteConversation).toHaveBeenCalled());

    expect(signal?.aborted).toBe(true);
  });

  it('only clears the page when there was no conversation on the server', async () => {
    const { api } = await setup();
    refs.newConversation.hidden = false;

    refs.newConversation.click();
    await Promise.resolve();

    expect(api.deleteConversation).not.toHaveBeenCalled();
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

  it('shows the conversation the tab had open, and its role', async () => {
    const { api } = await setup({
      storedConversation: ID,
      api: { fetchConversation: vi.fn(async () => transcript) },
    });

    expect(api.fetchConversation).toHaveBeenCalledWith(ID);
    expect(questions()).toEqual(['One', 'Two']);
    expect(refs.turnCounter.textContent).toBe('Turn 2 of 5');
    expect(/** @type {HTMLSelectElement} */ (refs.role).value).toBe('po');
    expect(refs.notice.hidden).toBe(true);
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
    expect(/** @type {HTMLButtonElement} */ (refs.ask).disabled).toBe(false);
  });

  it('keeps the stored conversation when the server could not be reached', async () => {
    const { storage } = await setup({
      storedConversation: ID,
      api: { fetchConversation: vi.fn(async () => Promise.reject(new ApiError('down'))) },
    });

    expect(storage.clearConversationId).not.toHaveBeenCalled();
    expect(refs.notice.hidden).toBe(true);
  });

  it('shows a conversation whose role is not offered any more with no depth', async () => {
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
    expect(refs.messages.querySelector('.feedback-area output')?.textContent).toBe(
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
    const form = /** @type {HTMLFormElement} */ (refs.messages.querySelector('form.feedback-form'));
    /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('comment')).value =
      '  Wrong window  ';
    /** @type {HTMLSelectElement} */ (form.elements.namedItem('source')).value = 'C1';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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

    expect(refs.messages.querySelector('.feedback-area output')?.textContent).toBe(text);
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

    expect(refs.messages.querySelector('.check-unchanged')?.textContent).toBe(
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
