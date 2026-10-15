// @ts-check
import { vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createAnswerMemory } from '../../src/server/answers.js';
import { buildApp } from '../../src/server/app.js';
import { validEnv } from './env.js';
import { createMemoryStream } from './memory-stream.js';
import { makeRole } from './role.js';

/** The address the test app answers to. */
export const LOOPBACK = ['127', '0', '0', '1'].join('.');
export const PORT = 3000;
export const OWN_HOST = `${LOOPBACK}:${PORT}`;
export const JSON_HEADERS = Object.freeze({
  host: OWN_HOST,
  'content-type': 'application/json',
});

/**
 * Builds an app with fakes for everything it depends on.
 * @param {object} [options] - What to replace.
 * @param {import('../../src/server/routes/ask.js').AskRouteDeps['ask']} [options.ask] - The fake `askQuestion`.
 * @param {import('../../src/server/app.js').AppDeps['saveFeedback']} [options.saveFeedback] - The fake store.
 * @param {import('../../src/server/answers.js').AnswerMemory} [options.answers] - The answer memory.
 * @param {import('../../src/server/app.js').AppDeps['staticFiles']} [options.staticFiles] - Files to serve.
 * @param {import('../../src/server/app.js').AppDeps['conversations']} [options.conversations] - The conversation routes' dependencies.
 * @returns {{ app: import('fastify').FastifyInstance, lines: () => Array<Record<string, unknown>>, answers: import('../../src/server/answers.js').AnswerMemory }}
 *   The app, the log lines written, and the memory.
 */
export function buildTestApp({
  ask = vi.fn(async () => {
    throw new Error('ask was not expected');
  }),
  saveFeedback = vi.fn(async () => undefined),
  answers = createAnswerMemory(),
  staticFiles = new Map(),
  conversations,
} = {}) {
  const { stream, lines } = createMemoryStream();
  const roles = new Map([
    ['tester', makeRole()],
    ['dev', makeRole({ id: 'dev', displayName: 'Developer', depth: 3 })],
  ]);
  const app = buildApp({
    config: loadConfig(validEnv()),
    roles,
    ask,
    answers,
    saveFeedback,
    conversations,
    staticFiles,
    logger: createLogger({ level: 'debug', destination: stream }),
  });
  return { app, lines, answers };
}

/**
 * Splits a Server-Sent Events body into its events.
 * @param {string} body - The whole response body.
 * @returns {Array<{ event: string, data: any }>} The events, in order.
 */
export function parseEvents(body) {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)),
      };
    });
}
