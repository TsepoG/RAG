// @ts-check
import { chip, FETCHED_AT, makeAnswer, makeConversation } from '../test/helpers/page.js';

/** The conversation every restored state belongs to. */
export const CONVERSATION_ID = '11111111-2222-4333-8444-555555555555';

/** The role the screenshots are taken as; its suggested questions are the real ones from roles/. */
export const ROLE_ID = 'product_owner';

/** The time the page believes it is, one minute after the sources were read, so badges say "1 min ago". */
export const NOW = FETCHED_AT + 60_000;

/** Both widths a state can be captured at. */
export const WIDTHS = Object.freeze({ desktop: 1440, phone: 390 });

/** What each state does after the page has loaded, before it is photographed. */
export const ACTIONS = Object.freeze({
  none: 'none',
  openSources: 'open-sources',
  ask: 'ask',
  copy: 'copy',
  openDrawer: 'open-drawer',
});

/** The question typed for the "in progress" state, with the words the mockup shows. */
export const IN_PROGRESS_QUESTION =
  'What happens when a customer cancels an order after it has shipped?';

/**
 * What the stream of the "in progress" state sends before it stays open: the steps, then the start of
 * a draft. Messages are the server's own wording from src/server/progress.js.
 */
export const IN_PROGRESS_EVENTS = Object.freeze([
  { event: 'progress', data: { kind: 'tool', message: 'Searching Confluence…' } },
  { event: 'progress', data: { kind: 'tool', message: 'Opening a Confluence page…' } },
  { event: 'progress', data: { kind: 'tool', message: 'Opening a Confluence page…' } },
  { event: 'progress', data: { kind: 'tool', message: 'Searching the code…' } },
  {
    event: 'token',
    data: {
      text: "The order can't be cancelled once it has shipped. Instead, the customer starts a return",
    },
  },
]);

/**
 * The state of the sources of an answer: read in turn 1 and checked a moment later.
 * @param {string[]} keys - The sources' keys.
 * @param {string[]} [changed] - Keys of the sources that were found changed.
 * @returns {Array<Record<string, unknown>>} One entry per key.
 */
function checked(keys, changed = []) {
  return keys.map((key) => {
    const isChanged = changed.includes(key);
    return {
      key,
      fetchedInTurn: 1,
      fetchedAt: FETCHED_AT,
      changed: isChanged,
      check: { status: isChanged ? 'changed' : 'unchanged', checkedAt: FETCHED_AT },
    };
  });
}

/**
 * Wraps turns the way the server's transcript does.
 * @param {Array<{ question: string, answer: ReturnType<typeof makeAnswer> }>} turns - Each question and its answer.
 * @param {Partial<import('../public/js/chatState.js').ConversationInfo>} [conversation] - Where the conversation stands.
 * @returns {Record<string, unknown>} The transcript.
 */
function transcript(turns, conversation = {}) {
  return {
    ...makeConversation({
      conversationId: CONVERSATION_ID,
      role: ROLE_ID,
      roleDepth: 1,
      turnCount: turns.length,
      ...conversation,
    }),
    turns: turns.map(({ question, answer }, index) => ({
      turn: index + 1,
      question,
      detailLevel: 'default',
      status: 'answered',
      answer,
    })),
  };
}

/**
 * An answer that is not one: the assistant says it found nothing, or that it cannot answer.
 * @param {'not_found' | 'out_of_scope'} status - Which reply.
 * @param {number} turn - Its turn.
 * @returns {ReturnType<typeof makeAnswer>} The reply.
 */
function declined(status, turn) {
  const notFound = status === 'not_found';
  return makeAnswer({
    answerId: `a${turn}`,
    turn,
    result: { status, confidence: null, confidenceReason: '', sources: [], alsoConsulted: [] },
    rendered: {
      level: null,
      banner: notFound
        ? "I couldn't find this in Confluence or the codebase."
        : "I don't have that information. I can only answer from the team's Confluence pages and code.",
      text: '',
      gaps: [],
      conflicts: [],
      closestPages: notFound
        ? [
            {
              key: 'C2',
              title: 'Payments FAQ',
              url: 'https://acme.atlassian.net/wiki/spaces/PAY/pages/2',
            },
          ]
        : [],
      whoToAsk: notFound ? [{ name: 'The payments team', sourceKeys: [] }] : [],
    },
    html: { answer: '', conflicts: [] },
    sourceStates: [],
  });
}

const FIRST = {
  question: 'What happens when a customer cancels an order after it has shipped?',
  answer: makeAnswer({
    answerId: 'a1',
    turn: 1,
    result: { confidence: 'high', confidenceReason: '' },
    rendered: { level: 'high', banner: 'Confirmed by the sources.', gaps: [], whoToAsk: [] },
    html: {
      answer: `<p>The order cannot be cancelled once it has shipped. The customer starts a return instead ${chip('C1')}.</p>`,
      conflicts: [],
    },
    sourceStates: checked(['C1', 'G1']),
  }),
};

const SECOND = {
  question: 'Does the refund go back to the original card?',
  answer: makeAnswer({
    answerId: 'a2',
    turn: 2,
    changedKeys: ['G1'],
    rendered: {
      whoToAsk: [],
      gaps: [
        "The documentation doesn't say whether customers are told about the store-credit fallback.",
      ],
    },
    html: {
      answer: `<p>Yes. Refunds go back to the payment method used for the order ${chip('C1')}. If that card has expired, the code falls back to store credit ${chip('G1', true)}.</p>`,
      conflicts: [],
    },
    sourceStates: checked(['C1', 'G1'], ['G1']),
  }),
};

/** Turn 2 with a changed source: the state the owner compares first. */
const CONVERSATION = transcript([FIRST, SECOND]);

/**
 * One state of the page to photograph, and the mockups to put next to it.
 * @typedef {object} State
 * @property {string} name - The name used in the file names.
 * @property {number[]} widths - The widths to photograph the page at.
 * @property {Partial<Record<number, string>>} mockups - The mockup file to photograph at each width, if any.
 * @property {Record<string, unknown> | null} transcript - What the server holds, or null for a page that starts empty.
 * @property {string} action - What to do on the page first, one of {@link ACTIONS}.
 * @property {boolean} [viewportOnly] - Photograph only what is on screen, not the whole page.
 */

/** @type {readonly State[]} */
export const STATES = Object.freeze([
  {
    name: 'welcome',
    widths: [WIDTHS.desktop, WIDTHS.phone],
    mockups: { [WIDTHS.desktop]: 'welcome.html' },
    transcript: null,
    action: ACTIONS.none,
  },
  {
    name: 'conversation',
    widths: [WIDTHS.desktop, WIDTHS.phone],
    mockups: { [WIDTHS.desktop]: 'conversation.html', [WIDTHS.phone]: 'phone.html' },
    transcript: CONVERSATION,
    action: ACTIONS.openSources,
  },
  {
    name: 'in-progress',
    widths: [WIDTHS.desktop, WIDTHS.phone],
    mockups: { [WIDTHS.desktop]: 'in-progress.html' },
    transcript: null,
    action: ACTIONS.ask,
  },
  {
    name: 'not-found',
    widths: [WIDTHS.desktop, WIDTHS.phone],
    mockups: { [WIDTHS.desktop]: 'not-found-and-ended.html' },
    transcript: transcript([
      {
        question: 'Which service supplies the currency exchange rates the system uses?',
        answer: declined('not_found', 1),
      },
    ]),
    action: ACTIONS.none,
  },
  {
    name: 'out-of-scope',
    widths: [WIDTHS.desktop, WIDTHS.phone],
    mockups: { [WIDTHS.desktop]: 'not-found-and-ended.html' },
    transcript: transcript([
      { question: 'What is the weather like tomorrow?', answer: declined('out_of_scope', 1) },
    ]),
    action: ACTIONS.none,
  },
  {
    name: 'ended',
    widths: [WIDTHS.desktop, WIDTHS.phone],
    mockups: { [WIDTHS.desktop]: 'not-found-and-ended.html' },
    transcript: transcript([FIRST, SECOND], { maxTurns: 2, full: 'turns', fullMessage: 'Full.' }),
    action: ACTIONS.none,
  },
  {
    name: 'toast',
    widths: [WIDTHS.desktop],
    mockups: {},
    transcript: CONVERSATION,
    action: ACTIONS.copy,
    viewportOnly: true,
  },
  {
    name: 'drawer',
    widths: [WIDTHS.phone],
    mockups: {},
    transcript: CONVERSATION,
    action: ACTIONS.openDrawer,
    viewportOnly: true,
  },
]);
