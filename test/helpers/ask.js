// @ts-check
import { vi } from 'vitest';
import { askQuestion } from '../../src/answer/askQuestion.js';
import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/logger/index.js';
import { fixtureInput } from './extraction.js';
import { createFakeClient, createFakeSession } from './fake-session.js';
import { validEnv } from './env.js';
import { createMemoryStream } from './memory-stream.js';
import { makeRole, TEST_ROLE } from './role.js';

const INVOCATION = { sessionId: 's' };
export const FENCE = '```';
export const NOW = Date.parse('2026-10-11T00:00:00Z');
export const NOT_FOUND_TEXT = "I couldn't find this in Confluence or the codebase.";
export const BUSINESS_ROLE = makeRole({ depth: 1, bannedTerms: ['endpoint'] });
export const META = {
  status: 'answered',
  confidence: 'high',
  confidenceReason: 'Stated in the page.',
  gaps: [],
  conflicts: [],
};
export const WINDOW = 'Refunds are allowed within thirty days of the order date';

/** @type {[string, string]} */
export const PAGE = ['atlassian-getConfluenceContent', 'getConfluenceContent'];
/** @type {[string, string]} */
export const FILE = ['github_repos-get_file_contents', 'get_file_contents'];
/** @type {[string, string, Record<string, unknown>]} */
export const FOLDER = [
  'github_repos-get_file_contents',
  'get_file_contents_dir',
  { owner: 'acme', repo: 'app', path: 'src' },
];

/**
 * Writes a reply the way the model should: the answer, then the report.
 * @param {string} text - The answer text.
 * @param {Record<string, unknown> | null} [meta] - Changes to the default report; null leaves the report out.
 * @returns {string} The reply.
 */
export function reply(text, meta = {}) {
  if (meta === null) {
    return text;
  }
  const report = JSON.stringify({ ...META, ...meta });
  return `${text}\n\n${FENCE}answer-meta\n${report}\n${FENCE}`;
}

/**
 * Delivers a tool result to the real post-tool hook, as the runtime would.
 * @param {ReturnType<typeof createFakeClient>} client - The fake client holding the hooks.
 * @param {string} toolName - Tool name.
 * @param {string} fixture - Fixture holding the result.
 * @param {Record<string, unknown>} [args] - Arguments to use instead of the fixture's.
 */
async function toolReturns(client, toolName, fixture, args) {
  const { hooks } = client.configs[0];
  const { args: toolArgs, text, log } = fixtureInput(fixture, args);
  const toolResult = {
    textResultForLlm: text,
    resultType: 'success',
    ...(log === undefined ? {} : { sessionLog: log }),
  };
  await hooks.onPostToolUse({ toolName, toolArgs, toolResult }, INVOCATION);
}

/**
 * Asks a question. The session answers each turn from `replies`, in order, and the last reply
 * repeats if there are more turns. A reply can also be a function that runs in the session.
 * @param {object} options - What happens.
 * @param {Array<string | ((context: { emit: (type: string, data: Record<string, unknown>) => void, client: any }) => void | Promise<void>)>} options.replies
 *   What the model says each turn.
 * @param {Array<[string, string, Record<string, unknown>?]>} [options.tools] - Tool results to deliver first.
 * @param {import('../../src/roles/index.js').Role} [options.role] - The role.
 * @param {import('../../src/roles/index.js').DetailLevel} [options.detailLevel] - How much detail to ask for.
 * @param {Record<string, string | undefined>} [options.env] - Environment overrides.
 * @param {typeof fetch} [options.fetchFunction] - The fake fetch.
 * @param {() => number} [options.now] - The clock.
 * @returns {Promise<{ result: import('../../src/answer/askQuestion.js').AskResult, session: any, client: any, lines: () => Array<Record<string, unknown>> }>}
 *   The result and the fakes.
 */
export async function ask({
  replies,
  tools = [],
  role = TEST_ROLE,
  detailLevel,
  env = {},
  fetchFunction = /** @type {typeof fetch} */ (
    vi.fn(async () => new Response('', { status: 404 }))
  ),
  now = () => NOW,
}) {
  const { stream, lines } = createMemoryStream();
  /** @type {any} */
  let client;
  let turn = 0;
  const session = createFakeSession({
    async script(emit) {
      if (turn === 0) {
        for (const [toolName, fixture, args] of tools) {
          await toolReturns(client, toolName, fixture, args);
        }
      }
      const next = replies[Math.min(turn, replies.length - 1)];
      turn += 1;
      if (typeof next === 'function') {
        await next({ emit, client });
        return;
      }
      emit('assistant.message', { content: next });
      emit('session.idle', {});
    },
  });
  client = createFakeClient(session);
  const result = await askQuestion(
    { role, detailLevel, question: 'How do refunds work?' },
    {
      client,
      workingDirectory: 'sandbox/work',
      config: loadConfig(validEnv(env)),
      logger: createLogger({ level: 'debug', destination: stream }),
      clock: { now },
      fetch: fetchFunction,
    },
  );
  return { result, session, client, lines };
}
