// @ts-check
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askQuestion } from '../../src/answer/index.js';
import { loadConfig, loadEnvFileIfPresent } from '../../src/config/index.js';
import { createCopilotClient, ensureAuthenticated } from '../../src/copilot/index.js';
import { createLogger } from '../../src/logger/index.js';
import { getRole, loadRoles } from '../../src/roles/index.js';

const LIVE_TIMEOUT_MS = 180_000;
// A GitHub link that names an exact commit: .../blob|tree|commit/<40 hex characters>[/...]
const PINNED_GITHUB_LINK =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree|commit)\/[0-9a-f]{40}(?:\/|$)/;
const CITATION_KEY = /\[([CG]\d+)\]/g;

/** @type {import('../../src/config/index.js').AppConfig} */
let config;
/** @type {Awaited<ReturnType<typeof createCopilotClient>>} */
let handle;
/** @type {Awaited<ReturnType<typeof askQuestion>>} */
let result;
const logger = createLogger({ level: 'silent' });

beforeAll(async () => {
  loadEnvFileIfPresent();
  config = loadConfig();
  const role = getRole(await loadRoles(), 'developer');
  handle = await createCopilotClient(config, { logger });
  await ensureAuthenticated(handle.client);
  const [repo] = config.github.repos;
  // One question for every check below, because each asks Copilot for a real answer.
  result = await askQuestion(
    {
      question: `What is the ${repo} repository about, and what do the Confluence pages say about it?`,
      role,
    },
    { client: handle.client, workingDirectory: handle.workingDirectory, config, logger },
  );
}, LIVE_TIMEOUT_MS * 2);

afterAll(async () => {
  await handle?.stop();
});

describe('live citations', () => {
  it('cites at least one source, and every key in the answer is one that was fetched', () => {
    const keysInAnswer = [...result.answer.matchAll(CITATION_KEY)].map(([, key]) => key);
    const known = new Set(result.sources.map(({ key }) => key));

    expect(keysInAnswer.length).toBeGreaterThan(0);
    expect(keysInAnswer.filter((key) => !known.has(key))).toEqual([]);
  });

  it('lists each cited source once, with a numbered key and an https link', () => {
    const keys = result.sources.map(({ key }) => key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(result.sources.every(({ url }) => url.startsWith('https://'))).toBe(true);
  });

  it('pins every GitHub link to a 40-character commit SHA', () => {
    const github = result.sources.filter(({ type }) => type === 'github');

    expect(github.filter(({ url }) => !PINNED_GITHUB_LINK.test(url))).toEqual([]);
  });

  it('links Confluence pages on the configured site, in the allowed spaces, with a version', () => {
    const allowed = new Set(config.atlassian.spaceKeys.map((key) => key.toLowerCase()));

    for (const page of result.sources) {
      if (page.type !== 'confluence') {
        continue;
      }
      expect(page.url.startsWith(config.atlassian.siteUrl)).toBe(true);
      expect(allowed.has(page.spaceKey.toLowerCase())).toBe(true);
      expect(page.version).toBeGreaterThan(0);
    }
  });
});
