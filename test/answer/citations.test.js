// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { askQuestion } from '../../src/answer/askQuestion.js';
import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/logger/index.js';
import { HEAD_SHA, fixtureInput } from '../helpers/extraction.js';
import { createFakeClient, createFakeSession } from '../helpers/fake-session.js';
import { FAKE_GITHUB_TOKEN, validEnv } from '../helpers/env.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { TEST_ROLE } from '../helpers/role.js';

const INVOCATION = { sessionId: 's' };

/**
 * Runs the real post-tool hook that the question registered with the session, as the runtime
 * would after a tool call.
 * @param {ReturnType<typeof createFakeClient>} client - The fake client holding the session config.
 * @param {string} toolName - Tool name as the runtime reports it.
 * @param {string} fixture - Fixture holding the result.
 * @param {Record<string, unknown>} [args] - Arguments to use instead of the fixture's.
 * @returns {Promise<void>} Resolves when the hook has finished.
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
 * Asks a question whose session first receives some tool results, then answers.
 * @param {object} options - What happens in the session.
 * @param {Array<[string, string, Record<string, unknown>?]>} [options.tools] - Tool results to
 *   deliver, as tool name, fixture and optional arguments.
 * @param {string} options.answer - What the model answers.
 * @param {Partial<import('../../src/answer/askQuestion.js').AskDeps>} [options.deps] - Dependency changes.
 * @returns {Promise<{ result: import('../../src/answer/askQuestion.js').AskResult, lines: () => Array<Record<string, unknown>>, client: ReturnType<typeof createFakeClient> }>}
 *   The result, the log and the client.
 */
async function ask({ tools = [], answer, deps = {} }) {
  const { stream, lines } = createMemoryStream();
  /** @type {ReturnType<typeof createFakeClient>} */
  let client;
  const session = createFakeSession({
    async script(emit) {
      for (const [toolName, fixture, args] of tools) {
        await toolReturns(client, toolName, fixture, args);
      }
      emit('assistant.message', { content: answer });
      emit('session.idle', {});
    },
  });
  client = createFakeClient(session);
  const result = await askQuestion(
    { role: TEST_ROLE, question: 'How do refunds work?' },
    {
      client,
      workingDirectory: 'sandbox/work',
      config: loadConfig(validEnv()),
      logger: createLogger({ level: 'debug', destination: stream }),
      clock: { now: () => Date.parse('2026-10-11T00:00:00Z') },
      fetch: /** @type {typeof fetch} */ (vi.fn(async () => new Response('{}', { status: 404 }))),
      ...deps,
    },
  );
  return { result, lines, client };
}

/** @type {[string, string]} */
const PAGE = ['atlassian-getConfluenceContent', 'getConfluenceContent'];
/** @type {[string, string]} */
const FILE = ['github_repos-get_file_contents', 'get_file_contents'];

describe('askQuestion citations', () => {
  it('returns the cited source, strips an invented key and reports it', async () => {
    const { result } = await ask({
      tools: [PAGE],
      answer: 'Refunds take 30 days [C1]. Large ones need approval [C9].',
    });

    expect(result.answer).toBe('Refunds take 30 days [C1]. Large ones need approval.');
    expect(result.invalidKeys).toEqual(['C9']);
    expect(result.sources).toEqual([
      expect.objectContaining({
        key: 'C1',
        type: 'confluence',
        id: '262439',
        spaceKey: 'ENG',
        version: 1,
        url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/262439',
        friendlyLabel: 'Page title 1 v1 — Confluence (ENG)',
      }),
    ]);
    expect(result.uncitedSourceKeys).toEqual([]);
  });

  it('lists a fetched source that was not cited in alsoConsulted, and says so by key', async () => {
    const { result } = await ask({
      tools: [PAGE, FILE],
      answer: 'Only the page matters [C1].',
    });

    expect(result.sources.map(({ key }) => key)).toEqual(['C1']);
    expect(result.uncitedSourceKeys).toEqual(['G1']);
    expect(result.alsoConsulted).toEqual([
      {
        key: 'G1',
        type: 'github',
        title: 'part-48.md',
        url: 'https://github.com/acme/app/blob/ebf99bea1fdf70b3a206c622a5134068c73eb607/part-48.md',
      },
    ]);
  });

  it('adds search hits that were never fetched, after the fetched ones, without repeats', async () => {
    const { result } = await ask({
      tools: [
        ['atlassian-searchConfluence', 'searchConfluence'],
        ['atlassian-searchConfluence', 'searchConfluence'],
        FILE,
      ],
      answer: 'Nothing cited here.',
    });

    expect(result.sources).toEqual([]);
    expect(result.alsoConsulted[0]).toMatchObject({ key: 'G1' });
    const urls = result.alsoConsulted.map(({ url }) => url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(result.alsoConsulted).toHaveLength(6);
    expect(result.alsoConsulted.slice(1).every(({ key }) => key === undefined)).toBe(true);
  });

  it('does not list a search hit again when the page behind it was fetched and cited', async () => {
    const { result } = await ask({
      tools: [['atlassian-searchConfluence', 'searchConfluence'], PAGE],
      answer: 'It is in the page [C1].',
    });

    const urls = result.alsoConsulted.map(({ url }) => url);
    expect(urls).not.toContain('https://acme.atlassian.net/wiki/spaces/ENG/pages/262439');
    expect(result.sources).toHaveLength(1);
  });

  it('returns the role it was written for', async () => {
    const { result } = await ask({ answer: 'Hi.' });

    expect(result.role).toBe(TEST_ROLE.id);
  });

  it('leaves an answer with no citations as it is', async () => {
    const { result } = await ask({ tools: [PAGE], answer: 'No citations here.' });

    expect(result).toMatchObject({
      status: 'not_found',
      confidence: null,
      answer: "I couldn't find this in Confluence or the codebase.",
      sources: [],
      invalidKeys: [],
      uncitedSourceKeys: ['C1'],
    });
    expect(result.alsoConsulted.map(({ key }) => key)).toEqual(['C1']);
  });

  it('numbers keys from one in every question, keeping questions apart', async () => {
    const first = await ask({ tools: [PAGE], answer: 'A [C1].' });
    const second = await ask({ tools: [PAGE], answer: 'B [C1].' });

    expect(first.result.sources[0].key).toBe('C1');
    expect(second.result.sources[0].key).toBe('C1');
  });

  it("keeps a source from one question out of the next question's citations", async () => {
    const first = await ask({ tools: [PAGE], answer: 'A [C1].' });
    const second = await ask({ answer: 'B [C1].' });

    expect(first.result.sources).toHaveLength(1);
    expect(second.result.sources).toEqual([]);
    expect(second.result.invalidKeys).toEqual(['C1']);
  });
});

describe('askQuestion commit pinning', () => {
  it('looks up the head commit with the GitHub token when a file result names none', async () => {
    const fetchFunction = vi.fn(async (/** @type {string} */ url) => {
      const body = url.endsWith('/repos/acme/app') ? { default_branch: 'main' } : { sha: HEAD_SHA };
      return new Response(JSON.stringify(body));
    });
    const { text } = fixtureInput('get_file_contents');
    const { stream } = createMemoryStream();
    /** @type {ReturnType<typeof createFakeClient>} */
    let client;
    const session = createFakeSession({
      async script(emit) {
        const { hooks } = client.configs[0];
        await hooks.onPostToolUse(
          {
            toolName: 'github_repos-get_file_contents',
            toolArgs: { owner: 'acme', repo: 'app', path: 'docs/Guide.md' },
            toolResult: { textResultForLlm: text, resultType: 'success' },
          },
          INVOCATION,
        );
        emit('assistant.message', { content: 'See the guide [G1].' });
        emit('session.idle', {});
      },
    });
    client = createFakeClient(session);

    const result = await askQuestion(
      { role: TEST_ROLE, question: 'Where is the guide?' },
      {
        client,
        workingDirectory: 'sandbox/work',
        config: loadConfig(validEnv()),
        logger: createLogger({ level: 'silent', destination: stream }),
        fetch: /** @type {typeof fetch} */ (fetchFunction),
      },
    );

    expect(result.sources[0]).toMatchObject({
      key: 'G1',
      commitSha: HEAD_SHA,
      url: `https://github.com/acme/app/blob/${HEAD_SHA}/docs/Guide.md`,
      pinned: true,
    });
    const [, init] = /** @type {[string, any]} */ (
      /** @type {unknown} */ (fetchFunction.mock.calls[0])
    );
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_GITHUB_TOKEN}`);
  });
});

describe('askQuestion keeps content from outside the allowed spaces from the model', () => {
  it('replaces the page, registers nothing, and leaves nothing to cite', async () => {
    /** @type {any} */
    let delivered;
    const { stream } = createMemoryStream();
    /** @type {ReturnType<typeof createFakeClient>} */
    let client;
    const session = createFakeSession({
      async script(emit) {
        const { hooks } = client.configs[0];
        const { text } = fixtureInput('getConfluenceContent');
        delivered = await hooks.onPostToolUse(
          {
            toolName: 'atlassian-getConfluenceContent',
            toolArgs: { content_url: 'https://acme.atlassian.net/wiki/spaces/HR/pages/262439' },
            toolResult: { textResultForLlm: text, resultType: 'success' },
          },
          INVOCATION,
        );
        emit('assistant.message', { content: 'Salaries are public [C1].' });
        emit('session.idle', {});
      },
    });
    client = createFakeClient(session);

    const result = await askQuestion(
      { role: TEST_ROLE, question: 'What do people earn?' },
      {
        client,
        workingDirectory: 'sandbox/work',
        config: loadConfig(validEnv()),
        logger: createLogger({ level: 'silent', destination: stream }),
      },
    );

    expect(delivered.modifiedResult.textResultForLlm).toBe(
      'Content removed: outside the allowed Confluence spaces.',
    );
    expect(result.sources).toEqual([]);
    expect(result.invalidKeys).toEqual(['C1']);
    expect(result.status).toBe('not_found');
    expect(result.answer).toBe("I couldn't find this in Confluence or the codebase.");
    expect(result.alsoConsulted).toEqual([]);
  });
});
