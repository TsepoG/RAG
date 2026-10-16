// @vitest-environment jsdom
// @ts-check
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChat } from '../../public/js/chat.js';
import { chip, FETCHED_AT, loadPage, makeAnswer, makeConversation } from '../helpers/page.js';

const ID = '11111111-2222-4333-8444-555555555555';
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

/** @type {import('../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
  document.documentElement.lang = 'en';
  document.title = 'Role-Aware Knowledge Assistant';
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
      conversation: makeConversation({ role: 'po', ...conversation }),
    },
  };
}

/**
 * A reply that is not an answer, as the server sends it.
 * @param {'not_found' | 'out_of_scope'} status - Which reply.
 * @param {number} turn - The turn.
 * @returns {{ event: string, data: any }} The event.
 */
function declined(status, turn) {
  const found = status === 'not_found';
  return done(
    {
      answerId: `a${turn}`,
      turn,
      result: { status, confidence: null, confidenceReason: '', sources: [], alsoConsulted: [] },
      rendered: {
        level: null,
        banner: found ? "I couldn't find anything about this." : "I don't have that information.",
        text: '',
        gaps: [],
        conflicts: [],
        closestPages: found
          ? [{ key: 'C2', title: 'Payments FAQ', url: 'https://acme.atlassian.net/wiki/2' }]
          : [],
        whoToAsk: found ? [{ name: 'The payments team', sourceKeys: [] }] : [],
      },
      html: { answer: '', conflicts: [] },
      sourceStates: [],
    },
    { turnCount: turn },
  );
}

/**
 * Starts the real page with a fake server that answers each message with the given events.
 * @param {Array<Array<{ event: string, data: unknown }> | Error | 'never'>} turns - What each message gets.
 * @returns {Promise<{ emit: (event: { event: string, data: unknown }) => void }>} A way to send events to a question that never ends.
 */
async function start(turns) {
  let message = 0;
  /** @type {{ emit: (event: { event: string, data: unknown }) => void }} */
  const live = { emit: vi.fn() };
  const api = {
    fetchRoles: async () => ROLES,
    createConversation: async () => ({ conversationId: ID, maxTurns: 5 }),
    sendMessage: vi.fn(async ({ onEvent }) => {
      const turn = turns[Math.min(message, turns.length - 1)];
      message += 1;
      if (turn === 'never') {
        live.emit = onEvent;
        return new Promise(() => undefined);
      }
      if (turn instanceof Error) {
        throw turn;
      }
      turn.forEach(onEvent);
      return undefined;
    }),
    fetchConversation: async () => ({ ...makeConversation({ role: 'po' }), turns: [] }),
    deleteConversation: async () => undefined,
    recheckAnswer: async () => ({ updates: [] }),
    sendFeedback: async () => undefined,
  };
  const chat = createChat({
    refs,
    api: /** @type {any} */ (api),
    storage: {
      loadRole: () => 'po',
      saveRole: () => undefined,
      loadConversationId: () => undefined,
      saveConversationId: () => undefined,
      clearConversationId: () => undefined,
    },
    clock: { now: () => FETCHED_AT },
    clipboard: { writeText: async () => undefined },
  });
  await chat.start();
  return live;
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
 * Checks the page with axe and says what is wrong in words. Colour contrast cannot be measured
 * without a real browser, so it is left to the owner's Lighthouse pass.
 * @returns {Promise<string[]>} One line for each violation, with the elements it found.
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

describe('the page has no accessibility violations that axe can find', () => {
  it('on the welcome screen', async () => {
    await start([[done()]]);

    expect(refs.welcome.hidden).toBe(false);
    expect(await violations()).toEqual([]);
  });

  it('lets a keyboard user bypass the repeated blocks with landmarks, since there is no skip link', async () => {
    await start([[done()]]);
    await ask('How?');

    const results = await axe.run(document, {
      runOnly: ['bypass', 'region', 'landmark-one-main', 'landmark-unique', 'page-has-heading-one'],
      resultTypes: ['violations', 'passes'],
    });

    expect(results.violations.map(({ id }) => id)).toEqual([]);
    expect(results.passes.map(({ id }) => id)).toContain('bypass');
    expect(document.querySelector('header.mobilebar')).not.toBeNull();
    expect(document.querySelector('main')).not.toBeNull();
  });

  it('on a conversation at turn 2, with a changed source and its Sources open', async () => {
    await start([
      [done({ answerId: 'a1', turn: 1 }, { turnCount: 1 })],
      [
        done(
          {
            answerId: 'a2',
            turn: 2,
            changedKeys: ['G1'],
            html: {
              answer: `<p>Refunds go back to the card ${chip('C1')} ${chip('G1', true)}.</p>`,
              conflicts: [],
            },
            rendered: {
              conflicts: ['The page says 30 days [C1].'],
            },
            sourceStates: [
              {
                key: 'C1',
                fetchedInTurn: 1,
                fetchedAt: FETCHED_AT,
                changed: false,
                check: { status: 'unchanged', checkedAt: FETCHED_AT },
              },
              {
                key: 'G1',
                fetchedInTurn: 2,
                fetchedAt: FETCHED_AT,
                changed: true,
                check: { status: 'changed', checkedAt: FETCHED_AT },
              },
            ],
          },
          { turnCount: 2 },
        ),
      ],
    ]);
    await ask('What happens when a customer cancels?');
    await ask('Does the refund go back to the original card?');
    /** @type {HTMLElement} */ (refs.messages.querySelectorAll('.sources__toggle')[1]).click();

    expect(refs.messages.querySelector('.notice--changed')).not.toBeNull();
    expect(refs.messages.querySelector('.source-row--changed')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('while an answer is on its way', async () => {
    const live = await start(['never']);
    await ask('What happens when a customer cancels?');
    live.emit({ event: 'progress', data: { message: 'Searching Confluence…' } });
    live.emit({ event: 'progress', data: { message: 'Opening a Confluence page…' } });
    live.emit({ event: 'token', data: { text: 'The order cannot be' } });

    expect(refs.messages.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('on a reply of not found, and one of out of scope', async () => {
    await start([[declined('not_found', 1)], [declined('out_of_scope', 2)]]);
    await ask('Is there a limit on partial refunds?');
    await ask('When is the next release going out?');

    expect(refs.messages.querySelector('.answer-card__panel')).not.toBeNull();
    expect(refs.messages.querySelectorAll('.pill--neutral')).toHaveLength(2);
    expect(await violations()).toEqual([]);
  });

  it('on a conversation that has ended', async () => {
    await start([[done({}, { turnCount: 5, full: 'turns', fullMessage: 'Full.' })]]);
    await ask('The last question');

    expect(refs.end.querySelector('.end-card')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('on a question that went wrong', async () => {
    await start([new Error('odd')]);
    await ask('How?');

    expect(refs.messages.querySelector('.answer-card--error')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it('with the phone drawer open', async () => {
    await start([[done()]]);
    await ask('How?');
    /** @type {HTMLElement} */ (refs.mobileBar.querySelector('.topbar__menu')).click();

    expect(refs.sidebar.classList.contains('is-open')).toBe(true);
    expect(await violations()).toEqual([]);
  });

  it('with the copy box open', async () => {
    await start([[done()]]);
    await ask('How?');
    const { buildCopyDialog } = await import('../../public/js/ui/copyConversation.js');
    document.body.append(buildCopyDialog('# the conversation', () => undefined));

    expect(await violations()).toEqual([]);
  });
});
