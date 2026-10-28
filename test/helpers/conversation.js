// @ts-check
import { vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { createConversationRunner, createConversationStore } from '../../src/conversation/index.js';
import { createLogger } from '../../src/logger/index.js';
import { toolReturns } from './ask.js';
import { validEnv } from './env.js';
import { createFakeClient, createFakeSession } from './fake-session.js';
import { createMemoryStream } from './memory-stream.js';
import { TEST_ROLE } from './role.js';

export const NOW = Date.parse('2026-10-11T00:00:00Z');

/**
 * What the model does in one turn: tool results the hooks see first, then a reply. A function
 * does something else in the session instead.
 * @typedef {string | {
 *   tools?: Array<[string, string, Record<string, unknown>?]>,
 *   reply?: string,
 *   script?: (context: { emit: (type: string, data: Record<string, unknown>) => void, client: any, hooks: any }) => void | Promise<void>,
 * }} ModelTurn
 */

/**
 * The pieces a conversation test works with.
 * @typedef {object} Harness
 * @property {import('../../src/conversation/index.js').Conversation} conversation - The conversation.
 * @property {ReturnType<typeof createConversationRunner>} runner - The runner.
 * @property {import('../../src/conversation/index.js').ConversationStore} store - The store.
 * @property {any} session - The fake session.
 * @property {any} client - The fake client.
 * @property {import('vitest').Mock} endConversation - Records how the runner ended the conversation.
 * @property {import('vitest').Mock} closeSession - Records how the store closed a session.
 * @property {() => Array<Record<string, unknown>>} lines - What was logged.
 * @property {(input?: Partial<import('../../src/conversation/index.js').TurnInput>) => Promise<any>} ask - Asks a question in the conversation.
 */

/**
 * A conversation with a fake session that plays the model's turns in order (the last repeats), the
 * real store, and the real runner.
 * @param {object} [options] - What differs from the usual.
 * @param {ModelTurn[]} [options.turns] - What the model does, one entry per message sent to it.
 * @param {Record<string, string | undefined>} [options.env] - Environment overrides.
 * @param {Partial<{ maxTurns: number, maxSourceChars: number, idleMinutes: number }>} [options.limits] - Limits to change.
 * @param {boolean} [options.abortGoesQuiet] - Whether aborting makes the session report idle, as the runtime does.
 * @param {Error} [options.createFailure] - Makes `createSession` reject.
 * @param {import('../../src/roles/index.js').Role} [options.role] - The role.
 * @param {Pick<import('../../src/atlassian/index.js').TokenProvider, 'getAtlassianToken'>} [options.atlassianTokens] - The signed-in tokens, in oauth mode.
 * @returns {Promise<Harness>} The pieces.
 */
export async function setupConversation({
  turns = [],
  env = {},
  limits = {},
  abortGoesQuiet = true,
  createFailure,
  role = TEST_ROLE,
  atlassianTokens,
} = {}) {
  const { stream, lines } = createMemoryStream();
  const logger = createLogger({ level: 'debug', destination: stream });
  const config = loadConfig(validEnv(env));
  let sent = 0;
  /** @type {any} */
  let client;
  const session = createFakeSession({
    async script(emit) {
      const step = turns[Math.min(sent, turns.length - 1)] ?? '';
      sent += 1;
      const turn = typeof step === 'string' ? { reply: step } : step;
      for (const [toolName, fixture, args] of turn.tools ?? []) {
        await toolReturns(client, toolName, fixture, args);
      }
      if (turn.script) {
        await turn.script({ emit, client, hooks: client.configs[0].hooks });
        return;
      }
      emit('assistant.message', { content: turn.reply ?? '' });
      emit('session.idle', {});
    },
  });
  if (abortGoesQuiet) {
    session.abort = vi.fn(async () => session.emit('session.idle', {}));
  }
  client = createFakeClient(session, createFailure);
  const clock = { now: () => NOW };
  const closeSession = vi.fn(async () => {});
  let next = 0;
  const store = createConversationStore({
    clock,
    limits: { maxTurns: 5, maxSourceChars: 250_000, idleMinutes: 30, ...limits },
    closeSession,
    newId: () => `conversation-${++next}`,
  });
  const conversation = await store.create({ role });
  const endConversation = vi.fn((target, reason) => store.end(target, reason));
  const runner = createConversationRunner({
    client,
    workingDirectory: 'sandbox/work',
    config,
    logger,
    clock,
    endConversation,
    fetch: vi.fn(async () => new Response('', { status: 404 })),
    atlassianTokens,
  });
  return {
    conversation,
    runner,
    store,
    session,
    client,
    endConversation,
    closeSession,
    lines,
    /**
     * Asks a question in the conversation.
     * @param {Partial<import('../../src/conversation/index.js').TurnInput>} [input] - Changes to the input.
     * @returns {Promise<any>} The result.
     */
    ask: (input = {}) => runner.ask(conversation, { question: 'How do refunds work?', ...input }),
  };
}
