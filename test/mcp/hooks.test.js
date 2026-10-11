// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logger/index.js';
import { createToolHooks } from '../../src/mcp/hooks.js';
import { createToolGate } from '../../src/mcp/toolGate.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

/** @typedef {import('../../src/mcp/hooks.js').ToolHooks} ToolHooks */

const INVOCATION = { sessionId: 'session-1' };
const SITE = 'https://acme.atlassian.net';
const PAGE_IN_ENG = `${SITE}/wiki/spaces/ENG/pages/1/Retry+policy`;

/**
 * Builds hooks wired to an in-memory logger and a clock the test controls.
 * @param {Partial<import('../../src/mcp/hooks.js').ToolHooksDeps>} [overrides] - Dependencies to
 *   replace.
 * @returns {{ hooks: ToolHooks, lines: () => Array<Record<string, unknown>>, setTime: (ms: number) => void }}
 *   The hooks, a reader for what they logged, and a way to move the clock.
 */
function setup(overrides = {}) {
  const { stream, lines } = createMemoryStream();
  let time = 0;
  const hooks = createToolHooks({
    repos: ['acme/app'],
    spaceKeys: ['ENG'],
    siteUrl: SITE,
    maxToolCalls: 5,
    logger: createLogger({ level: 'debug', destination: stream }),
    clock: { now: () => time },
    ...overrides,
  });
  return { hooks, lines, setTime: (ms) => (time = ms) };
}

/**
 * Calls the pre-tool hook.
 * @param {ToolHooks} hooks - The hooks.
 * @param {unknown} toolName - Tool name as the runtime would report it.
 * @param {unknown} toolArgs - Tool arguments.
 * @returns {{ permissionDecision: string, permissionDecisionReason?: string }} The decision.
 */
function pre(hooks, toolName, toolArgs) {
  const input = {
    toolName,
    toolArgs,
    sessionId: 's',
    timestamp: new Date(),
    workingDirectory: '.',
  };
  const decision = hooks.onPreToolUse?.(/** @type {never} */ (input), INVOCATION);
  return /** @type {{ permissionDecision: string, permissionDecisionReason?: string }} */ (
    decision
  );
}

/**
 * Calls the post-tool hook.
 * @param {ToolHooks} hooks - The hooks.
 * @param {string} toolName - Tool name.
 * @param {unknown} toolArgs - Tool arguments.
 * @param {unknown} text - What the tool returned.
 * @returns {ReturnType<NonNullable<ToolHooks['onPostToolUse']>> | undefined} What the hook returns.
 */
function post(hooks, toolName, toolArgs, text) {
  const input = {
    toolName,
    toolArgs,
    toolResult: { textResultForLlm: text, resultType: 'success' },
  };
  return hooks.onPostToolUse?.(/** @type {never} */ (input), INVOCATION);
}

/**
 * Calls the post-tool failure hook.
 * @param {ToolHooks} hooks - The hooks.
 * @param {string} toolName - Tool name.
 * @param {unknown} toolArgs - Tool arguments.
 * @param {unknown} error - The failure message.
 */
function postFailure(hooks, toolName, toolArgs, error) {
  const input = { toolName, toolArgs, error };
  hooks.onPostToolUseFailure?.(/** @type {never} */ (input), INVOCATION);
}

describe('onPreToolUse allows allow-listed tools within scope', () => {
  it.each([
    ['github_repos-get_file_contents', { owner: 'acme', repo: 'app', path: 'README.md' }],
    ['github_repos-get_commit', { owner: 'acme', repo: 'app', sha: 'abc' }],
    ['github_repos-list_commits', { owner: 'ACME', repo: 'App' }],
    ['github_repos-list_releases', { owner: 'acme', repo: 'app' }],
    ['github_repos-get_latest_release', { owner: 'acme', repo: 'app' }],
    ['github_repos-search_code', { query: 'retry repo:acme/app' }],
    ['atlassian-searchConfluence', { cloudId: 'c', cql: 'space = ENG AND text ~ "retry"' }],
    ['atlassian-getConfluenceContent', { cloudId: 'c', content_url: PAGE_IN_ENG }],
    ['atlassian-getAccessibleAtlassianResources', {}],
  ])('allows %s', (toolName, toolArgs) => {
    expect(pre(setup().hooks, toolName, toolArgs)).toEqual({ permissionDecision: 'allow' });
  });

  it('accepts a bare tool name that only one server lists', () => {
    const decision = pre(setup().hooks, 'get_file_contents', { owner: 'acme', repo: 'app' });

    expect(decision).toEqual({ permissionDecision: 'allow' });
  });
});

describe('onPreToolUse denies tools that are not allow-listed', () => {
  it.each([
    'github_repos-create_or_update_file',
    'github_repos-push_files',
    'github_repos-search_repositories',
    'atlassian-createConfluenceContent',
    'atlassian-updateConfluenceContent',
    'atlassian-search',
    'atlassian-executeRead',
    'atlassian-executeWrite',
    'atlassian-executeDestructive',
    'atlassian-discover',
    'atlassian-getJiraIssue',
    'rogue-get_file_contents',
    'bash',
    'view',
    'str_replace_editor',
    'web_fetch',
    'push_files',
    '',
  ])('denies %j', (toolName) => {
    expect(pre(setup().hooks, toolName, { owner: 'acme', repo: 'app' })).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'This tool is not available.',
    });
  });

  it('logs the denial with the tool and a reason code, never the arguments', () => {
    const { hooks, lines } = setup();

    pre(hooks, 'github_repos-push_files', { content: 'TOP-SECRET-BODY', token: 'tok-not-logged' });

    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'warn',
        msg: 'tool call denied',
        tool: 'github_repos-push_files',
        reason: 'not-allow-listed',
      }),
    ]);
    const logged = JSON.stringify(lines());
    expect(logged).not.toContain('TOP-SECRET-BODY');
    expect(logged).not.toContain('tok-not-logged');
  });
});

describe('onPreToolUse enforces the repository scope', () => {
  it.each([
    [{ owner: 'acme', repo: 'secrets' }, 'repo-not-allowed'],
    [{ owner: 'evil', repo: 'app' }, 'repo-not-allowed'],
    [{ owner: 'acme' }, 'repo-missing'],
    [undefined, 'repo-missing'],
  ])('denies get_file_contents with %j (%s)', (args, code) => {
    const { hooks, lines } = setup();

    const decision = pre(hooks, 'github_repos-get_file_contents', args);

    expect(decision.permissionDecision).toBe('deny');
    expect(lines()[0]).toMatchObject({ reason: code });
  });

  it.each([
    ['retry', 'query-no-repo'],
    ['retry repo:evil/x', 'query-repo-not-allowed'],
    ['retry repo:acme/app OR evil', 'query-or'],
    ['retry org:acme', 'query-widens'],
  ])('denies search_code %j (%s)', (query, code) => {
    const { hooks, lines } = setup();

    expect(pre(hooks, 'github_repos-search_code', { query }).permissionDecision).toBe('deny');
    expect(lines()[0]).toMatchObject({ reason: code });
  });

  it('gives the model the reason so it can correct the call', () => {
    const decision = pre(setup().hooks, 'github_repos-search_code', { query: 'retry' });

    expect(decision.permissionDecisionReason).toBe(
      'Add a repo:owner/name qualifier for an allowed repository.',
    );
  });
});

describe('onPreToolUse enforces the Confluence space scope', () => {
  it.each([
    [{ cloudId: 'c', cql: 'text ~ "retry"' }, 'cql-space'],
    [{ cloudId: 'c', cql: 'space = HR' }, 'cql-space-not-allowed'],
    [{ cloudId: 'c', cql: 'space = ENG OR space = HR' }, 'cql-boolean'],
    [{ cloudId: 'c', cql: 'space = ENG', cqlcontext: '{"spaceKey":"HR"}' }, 'cql-context'],
  ])('denies searchConfluence with %j (%s)', (args, code) => {
    const { hooks, lines } = setup();

    expect(pre(hooks, 'atlassian-searchConfluence', args).permissionDecision).toBe('deny');
    expect(lines()[0]).toMatchObject({ reason: code });
  });

  it.each([
    [{ cloudId: 'c', content_id: '123' }, 'content-id'],
    [{ cloudId: 'c', content_url: `${SITE}/wiki/spaces/HR/pages/1` }, 'content-space-not-allowed'],
    [{ cloudId: 'c', content_url: 'https://evil.example/wiki/spaces/ENG/pages/1' }, 'content-site'],
    [{ cloudId: 'c' }, 'content-url'],
  ])('denies getConfluenceContent with %j (%s)', (args, code) => {
    const { hooks, lines } = setup();

    expect(pre(hooks, 'atlassian-getConfluenceContent', args).permissionDecision).toBe('deny');
    expect(lines()[0]).toMatchObject({ reason: code });
  });
});

describe('onPreToolUse limits code searches to two per question', () => {
  const search = { query: 'repo:acme/app refund' };
  const HINT =
    'Code search returned no results; this repository may not be indexed. Browse with get_file_contents on directories instead of repeating search_code.';

  it('allows two code searches and denies the third with the hint', () => {
    const { hooks, lines } = setup();

    const decisions = [1, 2, 3].map(() => pre(hooks, 'github_repos-search_code', search));

    expect(decisions.map((decision) => decision.permissionDecision)).toEqual([
      'allow',
      'allow',
      'deny',
    ]);
    expect(decisions[2].permissionDecisionReason).toBe(HINT);
    expect(lines().at(-1)).toMatchObject({ reason: 'search-limit' });
  });

  it('keeps denying every code search after the second', () => {
    const { hooks } = setup({ maxToolCalls: 10 });

    const decisions = Array.from({ length: 5 }, () =>
      pre(hooks, 'github_repos-search_code', search),
    );

    expect(decisions.slice(2).every((decision) => decision.permissionDecision === 'deny')).toBe(
      true,
    );
  });

  it('does not limit the other tools, which are how the model is told to browse instead', () => {
    const { hooks } = setup();
    [1, 2, 3].forEach(() => pre(hooks, 'github_repos-search_code', search));

    const decision = pre(hooks, 'github_repos-get_file_contents', { owner: 'acme', repo: 'app' });

    expect(decision.permissionDecision).toBe('allow');
  });

  it('does not use up a search on a query the scope check refuses', () => {
    const { hooks } = setup();

    const refused = [1, 2, 3].map(() =>
      pre(hooks, 'github_repos-search_code', { query: 'refund' }),
    );
    const allowed = [1, 2].map(() => pre(hooks, 'github_repos-search_code', search));

    expect(refused.every((decision) => decision.permissionDecision === 'deny')).toBe(true);
    expect(allowed.map((decision) => decision.permissionDecision)).toEqual(['allow', 'allow']);
  });

  it('still counts a denied search towards the limit on all tool calls', () => {
    const { hooks } = setup({ maxToolCalls: 3 });

    pre(hooks, 'github_repos-search_code', search);
    pre(hooks, 'github_repos-search_code', search);
    pre(hooks, 'github_repos-search_code', search);
    const next = pre(hooks, 'github_repos-get_file_contents', { owner: 'acme', repo: 'app' });

    expect(next.permissionDecisionReason).toContain('limit of 3 tool calls');
  });

  it('gives each question its own two searches', () => {
    const first = setup().hooks;
    const second = setup().hooks;
    [1, 2].forEach(() => pre(first, 'github_repos-search_code', search));

    expect(pre(first, 'github_repos-search_code', search).permissionDecision).toBe('deny');
    expect(pre(second, 'github_repos-search_code', search).permissionDecision).toBe('allow');
  });
});

describe('onPreToolUse limits the number of tool calls', () => {
  const valid = { owner: 'acme', repo: 'app' };

  it('denies the call after the limit, even a valid one', () => {
    const { hooks, lines } = setup({ maxToolCalls: 2 });

    const decisions = [1, 2, 3].map(() => pre(hooks, 'github_repos-list_commits', valid));

    expect(decisions.map((decision) => decision.permissionDecision)).toEqual([
      'allow',
      'allow',
      'deny',
    ]);
    expect(decisions[2].permissionDecisionReason).toBe(
      'The limit of 2 tool calls is reached. Answer with what you have.',
    );
    expect(lines().at(-1)).toMatchObject({ reason: 'call-limit' });
  });

  it('counts denied calls too, so retrying a denied call cannot go on forever', () => {
    const { hooks } = setup({ maxToolCalls: 2 });

    pre(hooks, 'github_repos-push_files', {});
    pre(hooks, 'github_repos-push_files', {});
    const third = pre(hooks, 'github_repos-list_commits', valid);

    expect(third.permissionDecision).toBe('deny');
  });

  it('keeps counting separately for each set of hooks, so each question has its own budget', () => {
    const first = setup({ maxToolCalls: 1 }).hooks;
    const second = setup({ maxToolCalls: 1 }).hooks;

    pre(first, 'github_repos-list_commits', valid);

    expect(pre(first, 'github_repos-list_commits', valid).permissionDecision).toBe('deny');
    expect(pre(second, 'github_repos-list_commits', valid).permissionDecision).toBe('allow');
  });

  it('allows exactly as many calls as the limit', () => {
    const { hooks } = setup({ maxToolCalls: 12 });

    const decisions = Array.from({ length: 12 }, () =>
      pre(hooks, 'github_repos-list_commits', valid),
    );

    expect(decisions.every((decision) => decision.permissionDecision === 'allow')).toBe(true);
  });
});

describe('onPreToolUse only ever answers allow or deny, and fails closed', () => {
  const odd = [undefined, null, 0, 'text', [], {}, { owner: { toString: 'x' } }];

  it('never answers ask, whatever the tool name or arguments', () => {
    const names = [
      'github_repos-get_file_contents',
      'atlassian-searchConfluence',
      'bash',
      '',
      'x-y',
    ];
    const { hooks } = setup({ maxToolCalls: 1000 });

    const answers = names.flatMap((name) =>
      odd.map((args) => pre(hooks, name, args).permissionDecision),
    );

    expect(new Set(answers)).toEqual(new Set(['deny']));
  });

  it('answers allow or deny for valid calls and nothing else', () => {
    const { hooks } = setup();

    const answer = pre(hooks, 'github_repos-get_commit', { owner: 'acme', repo: 'app', sha: 'x' });

    expect(['allow', 'deny']).toContain(answer.permissionDecision);
  });

  it('denies, and logs at error, when the scope check throws', () => {
    const { hooks, lines } = setup({
      checkScope: () => {
        throw new Error('scope exploded');
      },
    });

    const decision = pre(hooks, 'github_repos-list_commits', { owner: 'acme', repo: 'app' });

    expect(decision).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'The tool call could not be checked, so it was not run.',
    });
    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'error',
        msg: 'pre-tool hook failed; denying',
        err: expect.objectContaining({ message: 'scope exploded' }),
      }),
    ]);
  });

  it('denies when the input cannot be read', () => {
    const { hooks } = setup();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('cannot read input');
        },
      },
    );

    const decision = hooks.onPreToolUse?.(/** @type {never} */ (hostile), INVOCATION);

    expect(decision).toMatchObject({ permissionDecision: 'deny' });
  });

  it('never allows anything while the scope check keeps throwing', () => {
    const { hooks } = setup({
      checkScope: () => {
        throw new Error('boom');
      },
    });
    const names = ['github_repos-get_commit', 'atlassian-searchConfluence', 'search_code'];

    const answers = names.map((name) => pre(hooks, name, {}).permissionDecision);

    expect(answers).toEqual(['deny', 'deny', 'deny']);
  });
});

describe('onPostToolUse', () => {
  it('logs the tool, how long it took and how big the result was', () => {
    const { hooks, lines, setTime } = setup();
    const args = { owner: 'acme', repo: 'app' };

    setTime(1000);
    pre(hooks, 'github_repos-list_commits', args);
    setTime(1450);
    post(hooks, 'github_repos-list_commits', args, 'x'.repeat(321));

    expect(lines().at(-1)).toMatchObject({
      level: 'info',
      msg: 'tool call completed',
      tool: 'github_repos-list_commits',
      durationMs: 450,
      resultChars: 321,
    });
  });

  it('never logs what the tool returned', () => {
    const { hooks, lines } = setup();
    const args = { owner: 'acme', repo: 'app' };

    pre(hooks, 'github_repos-list_commits', args);
    post(hooks, 'github_repos-list_commits', args, 'CONFIDENTIAL-PAGE-BODY ghp_not_logged');

    const logged = JSON.stringify(lines());
    expect(logged).not.toContain('CONFIDENTIAL-PAGE-BODY');
    expect(logged).not.toContain('ghp_not_logged');
  });

  it('times overlapping identical calls oldest first', () => {
    const { hooks, lines, setTime } = setup();
    const args = { owner: 'acme', repo: 'app' };

    setTime(0);
    pre(hooks, 'github_repos-list_commits', args);
    setTime(100);
    pre(hooks, 'github_repos-list_commits', args);
    setTime(300);
    post(hooks, 'github_repos-list_commits', args, 'a');
    setTime(350);
    post(hooks, 'github_repos-list_commits', args, 'b');

    const durations = lines()
      .filter((line) => line.msg === 'tool call completed')
      .map((line) => line.durationMs);
    expect(durations).toEqual([300, 250]);
  });

  it('times calls separately by their arguments', () => {
    const { hooks, lines, setTime } = setup();

    setTime(0);
    pre(hooks, 'github_repos-get_commit', { owner: 'acme', repo: 'app', sha: 'a' });
    setTime(40);
    pre(hooks, 'github_repos-get_commit', { owner: 'acme', repo: 'app', sha: 'b' });
    setTime(100);
    post(hooks, 'github_repos-get_commit', { owner: 'acme', repo: 'app', sha: 'b' }, 'x');

    expect(lines().at(-1)).toMatchObject({ durationMs: 60 });
  });

  it('logs no duration for a call it never saw start, and still logs the completion', () => {
    const { hooks, lines } = setup();

    post(hooks, 'github_repos-get_commit', {}, 'abc');

    const line = lines().at(-1);
    expect(line).toMatchObject({ msg: 'tool call completed', resultChars: 3 });
    expect(line).not.toHaveProperty('durationMs');
  });

  it('times a call whose arguments cannot be serialized, by tool name alone', () => {
    const { hooks, lines, setTime } = setup({ maxToolCalls: 5, checkScope: () => ({ ok: true }) });
    /** @type {Record<string, unknown>} */
    const circular = {};
    circular.self = circular;

    setTime(10);
    pre(hooks, 'github_repos-list_commits', circular);
    setTime(25);
    post(hooks, 'github_repos-list_commits', circular, 'abc');

    expect(lines().at(-1)).toMatchObject({ durationMs: 15 });
  });

  it('counts a result without text as empty', () => {
    const { hooks, lines } = setup();

    post(hooks, 'github_repos-get_commit', {}, undefined);

    expect(lines().at(-1)).toMatchObject({ resultChars: 0 });
  });

  it('logs, and does not throw, when the result cannot be read', () => {
    const { hooks, lines } = setup();

    expect(() =>
      hooks.onPostToolUse?.(/** @type {never} */ ({ toolName: 'x' }), INVOCATION),
    ).not.toThrow();
    expect(lines().at(-1)).toMatchObject({ level: 'error', msg: 'post-tool hook failed' });
  });
});

describe('onPostToolUseFailure', () => {
  it('logs the tool, how long it ran, how long the error was, and its text', () => {
    const { hooks, lines, setTime } = setup();
    const args = { owner: 'acme', repo: 'app' };

    setTime(5);
    pre(hooks, 'github_repos-list_commits', args);
    setTime(105);
    postFailure(hooks, 'github_repos-list_commits', args, 'HTTP 502: bad gateway');

    expect(lines().at(-1)).toMatchObject({
      level: 'warn',
      msg: 'tool call failed',
      tool: 'github_repos-list_commits',
      durationMs: 100,
      errorChars: 21,
      error: 'HTTP 502: bad gateway',
    });
  });

  it('cuts a long error to 300 characters', () => {
    const { hooks, lines } = setup();

    postFailure(hooks, 'github_repos-list_commits', {}, 'e'.repeat(1000));

    expect(lines().at(-1)).toMatchObject({ errorChars: 1000, error: `${'e'.repeat(299)}…` });
  });

  it('masks a configured secret inside the error text', () => {
    const { hooks, lines } = setup({ secrets: ['s3cret-token'] });

    postFailure(hooks, 'atlassian-searchConfluence', {}, 'denied for key s3cret-token (403)');

    expect(lines().at(-1)).toMatchObject({ error: 'denied for key *** (403)' });
    expect(JSON.stringify(lines())).not.toContain('s3cret-token');
  });

  it('masks a Bearer value and a token-shaped value even when no secret is configured', () => {
    const { hooks, lines } = setup();

    postFailure(hooks, 'atlassian-searchConfluence', {}, 'sent Bearer abc123 and ghp_echoedvalue');

    const output = JSON.stringify(lines());
    expect(output).not.toContain('abc123');
    expect(output).not.toContain('ghp_echoedvalue');
  });

  it('counts a missing error message as empty', () => {
    const { hooks, lines } = setup();

    postFailure(hooks, 'github_repos-list_commits', {}, undefined);

    expect(lines().at(-1)).toMatchObject({ errorChars: 0 });
    expect(lines().at(-1)).not.toHaveProperty('error');
  });

  it('logs, and does not throw, when its input cannot be read', () => {
    const { hooks, lines } = setup();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('cannot read input');
        },
      },
    );

    expect(() =>
      hooks.onPostToolUseFailure?.(/** @type {never} */ (hostile), INVOCATION),
    ).not.toThrow();
    expect(lines().at(-1)).toMatchObject({ level: 'error', msg: 'post-tool failure hook failed' });
  });
});

describe('createToolHooks defaults', () => {
  it('uses the real clock and scope check when none are injected', () => {
    const { stream, lines } = createMemoryStream();
    const hooks = createToolHooks({
      repos: ['acme/app'],
      spaceKeys: ['ENG'],
      siteUrl: SITE,
      maxToolCalls: 3,
      logger: createLogger({ level: 'debug', destination: stream }),
    });
    const args = { owner: 'acme', repo: 'app' };

    const decision = pre(hooks, 'github_repos-list_commits', args);
    post(hooks, 'github_repos-list_commits', args, 'abc');

    expect(decision).toEqual({ permissionDecision: 'allow' });
    expect(lines().at(-1)).toMatchObject({ msg: 'tool call completed' });
    expect(vi.isMockFunction(hooks.onPreToolUse)).toBe(false);
  });

  it('registers exactly the three hooks it implements', () => {
    expect(Object.keys(setup().hooks).sort()).toEqual([
      'onPostToolUse',
      'onPostToolUseFailure',
      'onPreToolUse',
    ]);
  });
});

describe('onPreToolUse sets the cloudId on Confluence calls', () => {
  const CLOUD_ID = '82b58a78-f056-49aa-a740-c3c946f68f8b';
  const search = { cql: 'space = ENG AND text ~ "retry"', limit: 5 };

  /**
   * Reads the arguments a decision asks the call to run with.
   * @param {ToolHooks} hooks - The hooks.
   * @param {string} tool - Tool name.
   * @param {unknown} args - Arguments.
   * @returns {unknown} The replacement arguments, if any.
   */
  const modified = (hooks, tool, args) =>
    /** @type {{ modifiedArgs?: unknown }} */ (pre(hooks, tool, args)).modifiedArgs;

  it('adds it when the model sent none', () => {
    const { hooks } = setup({ cloudId: CLOUD_ID });

    expect(modified(hooks, 'atlassian-searchConfluence', search)).toEqual({
      ...search,
      cloudId: CLOUD_ID,
    });
  });

  it.each(['<fill>', 'wrong-id', '', 42])('replaces the value %j the model sent', (value) => {
    const { hooks } = setup({ cloudId: CLOUD_ID });
    const args = { content_url: PAGE_IN_ENG, cloudId: value };

    expect(modified(hooks, 'atlassian-getConfluenceContent', args)).toEqual({
      content_url: PAGE_IN_ENG,
      cloudId: CLOUD_ID,
    });
  });

  it('still allows the call, and does not change the arguments object the model sent', () => {
    const { hooks } = setup({ cloudId: CLOUD_ID });
    const args = { ...search };

    const decision = pre(hooks, 'atlassian-searchConfluence', args);

    expect(decision.permissionDecision).toBe('allow');
    expect(args).toEqual(search);
  });

  it('leaves the arguments alone when no cloudId is configured', () => {
    const { hooks } = setup();

    const decision = pre(hooks, 'atlassian-searchConfluence', { ...search, cloudId: '<fill>' });

    expect(decision).toEqual({ permissionDecision: 'allow' });
  });

  it.each([
    ['atlassian-getAccessibleAtlassianResources', {}],
    ['github_repos-get_file_contents', { owner: 'acme', repo: 'app' }],
  ])('does not add it to %s', (tool, args) => {
    const { hooks } = setup({ cloudId: CLOUD_ID });

    expect(pre(hooks, tool, args)).toEqual({ permissionDecision: 'allow' });
  });

  it('checks the scope first, so a denied call is not rewritten', () => {
    const { hooks } = setup({ cloudId: CLOUD_ID });

    const decision = pre(hooks, 'atlassian-searchConfluence', {
      cql: 'space = OTHER AND text ~ "x"',
    });

    expect(decision.permissionDecision).toBe('deny');
    expect(decision).not.toHaveProperty('modifiedArgs');
  });

  it('times the call whichever form of the arguments the post-tool hook reports', async () => {
    const { hooks, lines, setTime } = setup({ cloudId: CLOUD_ID });
    pre(hooks, 'atlassian-searchConfluence', search);
    setTime(40);

    await post(hooks, 'atlassian-searchConfluence', { ...search, cloudId: CLOUD_ID }, '{}');

    expect(lines().find((line) => line.msg === 'tool call completed')).toMatchObject({
      durationMs: 40,
    });
  });
});

describe('onPreToolUse refuses every call while the gate is locked', () => {
  /** @type {Array<[string, string, unknown]>} */
  const calls = [
    [
      'an allow-listed GitHub tool',
      'github_repos-get_file_contents',
      { owner: 'acme', repo: 'app' },
    ],
    ['a Confluence search', 'atlassian-searchConfluence', { cql: 'space = ENG AND text ~ "x"' }],
    ['a Confluence page', 'atlassian-getConfluenceContent', { content_url: PAGE_IN_ENG }],
    ['a code search', 'github_repos-search_code', { query: 'repo:acme/app refund' }],
    [
      'a tool that is not allow-listed',
      'github_repos-create_issue',
      { owner: 'acme', repo: 'app' },
    ],
    [
      'a call outside the allowed repositories',
      'github_repos-get_file_contents',
      { owner: 'evil', repo: 'x' },
    ],
    ['a call with no arguments', 'github_repos-list_commits', undefined],
  ];

  it.each(calls)('denies %s, with the reason and a code in the log', (_name, tool, args) => {
    const gate = createToolGate();
    const { hooks, lines } = setup({ gate });
    gate.lock();

    expect(pre(hooks, tool, args)).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'Tools are not available while rewriting.',
    });
    expect(lines().at(-1)).toMatchObject({ reason: 'tools-locked', tool });
  });

  it('allows the same calls until the gate is locked, then refuses them', () => {
    const gate = createToolGate();
    const { hooks } = setup({ gate });
    const call = /** @type {[string, unknown]} */ ([
      'github_repos-get_file_contents',
      { owner: 'acme', repo: 'app' },
    ]);

    const before = pre(hooks, ...call);
    gate.lock();
    const after = pre(hooks, ...call);

    expect([before.permissionDecision, after.permissionDecision]).toEqual(['allow', 'deny']);
  });

  it('does not rewrite the arguments of a call it refuses', () => {
    const gate = createToolGate();
    const { hooks } = setup({ gate, cloudId: '82b58a78-f056-49aa-a740-c3c946f68f8b' });
    gate.lock();

    const decision = pre(hooks, 'atlassian-searchConfluence', {
      cql: 'space = ENG AND text ~ "x"',
    });

    expect(decision).not.toHaveProperty('modifiedArgs');
  });

  it('refuses even when the call limit has not been reached, and does not count the refusal', () => {
    const gate = createToolGate();
    const { hooks } = setup({ gate, maxToolCalls: 1 });
    gate.lock();

    [1, 2, 3].forEach(() =>
      pre(hooks, 'github_repos-get_file_contents', { owner: 'acme', repo: 'app' }),
    );

    expect(
      pre(hooks, 'github_repos-get_file_contents', { owner: 'acme', repo: 'app' })
        .permissionDecisionReason,
    ).toBe('Tools are not available while rewriting.');
  });

  it('denies, rather than allows, when the gate itself fails', () => {
    const broken = {
      lock: () => undefined,
      isLocked: () => {
        throw new Error('gate broke');
      },
    };
    const { hooks } = setup({ gate: broken });

    expect(
      pre(hooks, 'github_repos-get_file_contents', { owner: 'acme', repo: 'app' }),
    ).toMatchObject({
      permissionDecision: 'deny',
    });
  });

  it('is open by default, and each set of hooks has its own gate', () => {
    const { hooks } = setup();

    expect(
      pre(hooks, 'github_repos-get_file_contents', { owner: 'acme', repo: 'app' })
        .permissionDecision,
    ).toBe('allow');
  });
});
