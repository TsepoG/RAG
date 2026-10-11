// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askQuestion } from '../../src/answer/index.js';
import { loadConfig, loadEnvFileIfPresent } from '../../src/config/index.js';
import { createCopilotClient, ensureAuthenticated } from '../../src/copilot/index.js';
import { renderFinalAnswer } from '../../src/honesty/index.js';
import { createLogger } from '../../src/logger/index.js';
import { getRole, loadRoles } from '../../src/roles/index.js';

const LIVE_TIMEOUT_MS = 180_000;
const STATUSES = ['answered', 'not_found', 'clarify', 'out_of_scope'];
const LEVELS = ['high', 'medium', 'low'];
// A question the team's Confluence pages and code cannot answer. The model has no source to cite,
// so the application must never show it as an answer, whatever the model does.
const OFF_TOPIC = 'What is the capital of France?';

/** @type {import('../../src/config/index.js').AppConfig} */
let config;
/** @type {Awaited<ReturnType<typeof createCopilotClient>>} */
let handle;
/** @type {import('../../src/roles/index.js').Role} */
let role;
/** @type {Awaited<ReturnType<typeof askQuestion>>} */
let onTopic;
/** @type {Awaited<ReturnType<typeof askQuestion>>} */
let offTopic;
const logger = createLogger({ level: 'silent' });

/**
 * Asks a question against the real services.
 * @param {string} question - The question.
 * @returns {ReturnType<typeof askQuestion>} The result.
 */
function ask(question) {
  return askQuestion(
    { question, role },
    { client: handle.client, workingDirectory: handle.workingDirectory, config, logger },
  );
}

beforeAll(async () => {
  loadEnvFileIfPresent();
  config = loadConfig();
  role = getRole(await loadRoles(), 'product_owner');
  handle = await createCopilotClient(config, { logger });
  await ensureAuthenticated(handle.client);
  const [repo] = config.github.repos;
  // Two questions for every check below, because each asks Copilot for a real answer.
  onTopic = await ask(`What does the ${repo} repository do today, and what is planned?`);
  offTopic = await ask(OFF_TOPIC);
}, LIVE_TIMEOUT_MS * 3);

afterAll(async () => {
  await handle?.stop();
});

/**
 * Checks what must hold for any result, whatever the model said.
 * @param {Awaited<ReturnType<typeof askQuestion>>} result - The result.
 */
function expectConsistent(result) {
  expect(STATUSES).toContain(result.status);
  expect(result.confidenceReason.trim()).not.toBe('');
  expect(Array.isArray(result.capsApplied)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('answer-meta');
  if (result.status === 'answered') {
    expect(LEVELS).toContain(result.confidence);
  } else {
    expect(result.confidence).toBeNull();
    expect(result.sources).toEqual([]);
  }
}

describe('live honesty', () => {
  it('gives a question about the project a status, a level and a banner', () => {
    expectConsistent(onTopic);

    const { banner } = renderFinalAnswer(onTopic, role);
    expect(onTopic.status === 'clarify' || banner.trim() !== '').toBe(true);
  });

  it('shows only cited keys that are listed sources', () => {
    const keys = [...onTopic.answer.matchAll(/\[([CG]\d+)\*?\]/g)].map(([, key]) => key);
    const known = new Set(onTopic.sources.map(({ key }) => key));

    expect(keys.filter((key) => !known.has(key))).toEqual([]);
  });

  it('never shows a question the sources cannot answer as an answer', () => {
    expectConsistent(offTopic);

    expect(['not_found', 'out_of_scope', 'clarify']).toContain(offTopic.status);
    expect(offTopic.sources).toEqual([]);
    expect(offTopic.answer).not.toMatch(/paris/i);
  });

  it("states the text for a question it cannot answer in the role's own words", () => {
    const { banner, text } = renderFinalAnswer(offTopic, role);

    expect(offTopic.status === 'clarify' || banner.trim() !== '').toBe(true);
    expect(text).not.toMatch(/paris/i);
  });
});
