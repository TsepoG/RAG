// @ts-check
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askQuestion } from '../../src/answer/index.js';
import { listSecrets, loadConfig, loadEnvFileIfPresent } from '../../src/config/index.js';
import { createCopilotClient, ensureAuthenticated } from '../../src/copilot/index.js';
import { createLogger } from '../../src/logger/index.js';
import { loadRoles } from '../../src/roles/index.js';
import { createAnswerMemory } from '../../src/server/answers.js';
import { buildApp } from '../../src/server/app.js';
import { appendFeedback, FEEDBACK_FILE } from '../../src/server/feedbackStore.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { parseEvents } from '../helpers/server.js';

const LIVE_TIMEOUT_MS = 180_000;
const LOOPBACK = ['127', '0', '0', '1'].join('.');
const CANCEL_WAIT_MS = 30_000;
const POLL_MS = 250;
const TERMINAL = new Set(['done', 'error']);
const SCHEME = 'http:';

/** @type {import('../../src/config/index.js').AppConfig} */
let config;
/** @type {Awaited<ReturnType<typeof createCopilotClient>>} */
let handle;
/** @type {ReadonlyMap<string, import('../../src/roles/index.js').Role>} */
let roles;
/** @type {string} */
let feedbackDir;
const { stream, lines } = createMemoryStream();
const logger = createLogger({ level: 'info', destination: stream });

beforeAll(async () => {
  loadEnvFileIfPresent();
  config = loadConfig();
  roles = await loadRoles();
  feedbackDir = await mkdtemp(join(tmpdir(), 'live-feedback-'));
  handle = await createCopilotClient(config, { logger });
  await ensureAuthenticated(handle.client);
}, LIVE_TIMEOUT_MS);

afterAll(async () => {
  await handle?.stop();
  await rm(feedbackDir, { recursive: true, force: true });
});

/**
 * Builds the real app: the real `askQuestion`, Copilot and MCP servers, with feedback written to a
 * temporary folder instead of `data/`.
 * @param {import('../../src/server/answers.js').AnswerMemory} [answers] - The answer memory.
 * @returns {import('fastify').FastifyInstance} The app.
 */
function buildLiveApp(answers = createAnswerMemory()) {
  return buildApp({
    config,
    roles,
    ask: (input) =>
      askQuestion(input, {
        client: handle.client,
        workingDirectory: handle.workingDirectory,
        config,
        logger,
      }),
    answers,
    saveFeedback: (answer, input) => appendFeedback(answer, input, { dir: feedbackDir }),
    staticFiles: new Map(),
    logger,
  });
}

/**
 * Asks about the first configured repository.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @returns {Promise<import('light-my-request').Response>} The streamed response.
 */
function askAboutTheRepository(app) {
  const [repo] = config.github.repos;
  return app.inject({
    method: 'POST',
    url: '/api/ask',
    headers: { host: `${LOOPBACK}:${config.port}`, 'content-type': 'application/json' },
    payload: JSON.stringify({
      question: `In one sentence, what is the ${repo} repository about?`,
      role: 'product_owner',
      detailLevel: 'default',
    }),
  });
}

describe('live web server', () => {
  it(
    'streams progress, then draft text, then exactly one done, and never shows the answer-meta block or a secret',
    async () => {
      const answers = createAnswerMemory();
      const app = buildLiveApp(answers);

      const response = await askAboutTheRepository(app);
      const events = parseEvents(response.body);
      const names = events.map(({ event }) => event);
      const done = events.find(({ event }) => event === 'done');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(names).toContain('progress');
      expect(names).toContain('token');
      expect(names.filter((name) => TERMINAL.has(name))).toEqual(['done']);
      expect(names.at(-1)).toBe('done');
      expect(names.indexOf('progress')).toBeLessThan(names.indexOf('done'));

      // The report block must not appear in any event, and no secret may leave the server.
      expect(response.body.toLowerCase()).not.toContain('answer-meta');
      for (const secret of listSecrets(config)) {
        expect(response.body).not.toContain(secret);
      }

      expect(done?.data.answerId).toEqual(expect.any(String));
      expect(['answered', 'not_found', 'clarify', 'out_of_scope']).toContain(
        done?.data.result.status,
      );
      expect(done?.data.html.answer).not.toMatch(/<script|onerror|javascript:/i);
      expect(answers.get(done?.data.answerId)).toBeDefined();
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'saves feedback for that answer without the answer text',
    async () => {
      const answers = createAnswerMemory();
      const app = buildLiveApp(answers);
      const asked = parseEvents((await askAboutTheRepository(app)).body).find(
        ({ event }) => event === 'done',
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { host: `${LOOPBACK}:${config.port}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ answerId: asked?.data.answerId, rating: 'up' }),
      });
      const saved = await readFile(join(feedbackDir, FEEDBACK_FILE), 'utf8');

      expect(response.statusCode).toBe(200);
      expect(saved.trim().split('\n')).toHaveLength(1);
      expect(JSON.parse(saved)).toMatchObject({ rating: 'up', role: 'product_owner' });
      expect(saved).not.toContain(asked?.data.result.answer.slice(0, 40));
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'aborts the session when the browser goes away',
    async () => {
      // Listens on the configured PORT, because the guards only accept that one: stop `npm start` first.
      const app = buildLiveApp();
      await app.listen({ host: LOOPBACK, port: config.port });
      const controller = new AbortController();
      const [repo] = config.github.repos;
      try {
        const response = await fetch(`${SCHEME}//${LOOPBACK}:${config.port}/api/ask`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question: `List what each top-level folder of ${repo} is for.`,
            role: 'developer',
            detailLevel: 'default',
          }),
          signal: controller.signal,
        });
        const reader = /** @type {ReadableStreamDefaultReader} */ (response.body?.getReader());
        await reader.read();
        controller.abort();
        await reader.cancel().catch(() => undefined);

        const aborted = () =>
          lines().some(({ msg }) => msg === 'the question was cancelled; aborting the session');
        for (let waited = 0; !aborted() && waited < CANCEL_WAIT_MS; waited += POLL_MS) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }

        expect(aborted()).toBe(true);
      } finally {
        await app.close();
      }
    },
    LIVE_TIMEOUT_MS,
  );
});
