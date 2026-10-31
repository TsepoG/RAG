// @ts-check
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';
import { createConversationStore } from '../../../src/conversation/index.js';
import { GithubSignInRequiredError } from '../../../src/errors/index.js';
import { createLogger } from '../../../src/logger/index.js';
import { createAnswerMemory } from '../../../src/server/answers.js';
import { buildApp } from '../../../src/server/app.js';
import { fakeRunner, START } from '../../helpers/conversationApp.js';
import { validEnv } from '../../helpers/env.js';
import { createMemoryStream } from '../../helpers/memory-stream.js';
import { makeRole } from '../../helpers/role.js';
import { JSON_HEADERS } from '../../helpers/server.js';

const FAKE_CLI_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';

/**
 * Builds a gh-cli-mode app whose runner fails its pre-turn check the given way.
 * @param {() => Promise<void>} prepare - What the runner does before a turn.
 * @returns {{ app: import('fastify').FastifyInstance, runner: { ask: import('vitest').Mock, prepare: import('vitest').Mock }, store: ReturnType<typeof createConversationStore>, lines: () => Array<Record<string, unknown>> }} The app and its doubles.
 */
function ghCliApp(prepare) {
  const store = createConversationStore({
    clock: { now: () => START },
    limits: { maxTurns: 5, maxSourceChars: 1000, idleMinutes: 30 },
    closeSession: async () => undefined,
    newId: randomUUID,
  });
  const runner = { ...fakeRunner([{}]), prepare: vi.fn(prepare) };
  const memory = createMemoryStream();
  const app = buildApp({
    config: loadConfig(validEnv({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined })),
    roles: new Map([['tester', makeRole()]]),
    ask: vi.fn(),
    answers: createAnswerMemory(),
    saveFeedback: vi.fn(),
    conversations: { store, runner, recheck: { manual: vi.fn(), auto: vi.fn() } },
    staticFiles: new Map(),
    logger: createLogger({ destination: memory.stream }),
  });
  return { app, runner, store, lines: memory.lines };
}

/**
 * Starts a conversation and asks a question in it.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @returns {Promise<import('light-my-request').Response>} The answer to the question.
 */
async function askOnce(app) {
  const started = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    headers: JSON_HEADERS,
    payload: { role: 'tester' },
  });
  return app.inject({
    method: 'POST',
    url: `/api/conversations/${started.json().conversationId}/messages`,
    headers: JSON_HEADERS,
    payload: { question: 'Which tags does the code try?' },
  });
}

describe('a question in gh-cli mode when the GitHub CLI has no token', () => {
  it.each([
    ['logged-out', "GitHub CLI isn't logged in. Run `gh auth login` in a terminal."],
    ['sso', 'Run `gh auth refresh -h github.com` to authorise your organisation.'],
    ['cli-missing', 'GitHub CLI not found — install it or set GITHUB_CLI_PATH.'],
  ])(
    'is refused with 401 github_signin_required (%s), before any turn starts',
    async (reason, message) => {
      const { app, runner, store, lines } = ghCliApp(async () => {
        throw new GithubSignInRequiredError(
          /** @type {import('../../../src/errors/index.js').GithubSignInReason} */ (reason),
          { cause: new Error(`gh said ${FAKE_CLI_TOKEN}`) },
        );
      });

      const response = await askOnce(app);

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ code: 'github_signin_required', reason, message });
      expect(runner.ask).not.toHaveBeenCalled();
      expect(store.active()?.turnCount()).toBe(0);
      expect(store.active()?.endedReason()).toBeUndefined();
      expect(JSON.stringify(lines())).toContain('refused a question: the GitHub CLI has no token');
      expect(JSON.stringify(lines())).not.toContain(FAKE_CLI_TOKEN);
      expect(response.body).not.toContain(FAKE_CLI_TOKEN);
    },
  );

  it('passes on any other failure of the pre-turn check', async () => {
    const { app } = ghCliApp(async () => {
      throw new Error('something else');
    });

    expect((await askOnce(app)).statusCode).toBe(500);
  });
});
