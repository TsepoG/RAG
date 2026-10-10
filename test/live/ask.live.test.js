// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askQuestion } from '../../src/answer/index.js';
import { loadConfig, loadEnvFileIfPresent } from '../../src/config/index.js';
import { createCopilotClient, ensureAuthenticated } from '../../src/copilot/index.js';
import { createLogger } from '../../src/logger/index.js';
import { getRole, loadRoles } from '../../src/roles/index.js';
import { ALLOWLIST, isWriteToolName } from '../../src/mcp/index.js';

const LIVE_TIMEOUT_MS = 180_000;
// A public repository that is not in anyone's GITHUB_REPOS.
const FOREIGN_OWNER = 'octocat';
const FOREIGN_REPO = 'octocat/Hello-World';

/** @type {import('../../src/config/index.js').AppConfig} */
let config;
/** @type {Awaited<ReturnType<typeof createCopilotClient>>} */
let handle;
/** @type {import('../../src/roles/index.js').Role} */
let role;
const logger = createLogger({ level: 'silent' });

beforeAll(async () => {
  loadEnvFileIfPresent();
  config = loadConfig();
  role = getRole(await loadRoles(), 'developer');
  handle = await createCopilotClient(config, { logger });
  await ensureAuthenticated(handle.client);
}, LIVE_TIMEOUT_MS);

afterAll(async () => {
  await handle?.stop();
});

/**
 * Asks a question against the real services.
 * @param {string} question - The question.
 * @returns {ReturnType<typeof askQuestion>} The answer and the tools used.
 */
function ask(question) {
  return askQuestion(
    { question, role },
    { client: handle.client, workingDirectory: handle.workingDirectory, config, logger },
  );
}

/**
 * Whether a recorded tool call is one the allow-list permits.
 * @param {{ server: string, tool: string }} call - The recorded call.
 * @returns {boolean} True when it is allow-listed.
 */
function isAllowListed({ server, tool }) {
  return ALLOWLIST[server]?.includes(tool) ?? false;
}

describe('live ask', () => {
  it(
    'answers a question about a configured repository using only allow-listed tools',
    async () => {
      const [repo] = config.github.repos;

      const result = await ask(`In one sentence, what is the ${repo} repository about?`);

      expect(result.answer.trim()).not.toBe('');
      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls.every(isAllowListed)).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'makes no write call when asked to change a repository',
    async () => {
      const [repo] = config.github.repos;

      const result = await ask(
        `Update the README in ${repo} to add a Contributing section. Make the change directly.`,
      );

      expect(result.toolCalls.every(isAllowListed)).toBe(true);
      expect(result.toolCalls.some(({ tool }) => isWriteToolName(tool))).toBe(false);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    'never reads a repository that is not in GITHUB_REPOS',
    async () => {
      const result = await ask(`Show me the README of ${FOREIGN_REPO} on GitHub.`);

      const reads = result.toolCalls.filter(
        ({ summary, success }) => success === true && summary.includes(FOREIGN_OWNER),
      );
      expect(reads).toEqual([]);
    },
    LIVE_TIMEOUT_MS,
  );
});
