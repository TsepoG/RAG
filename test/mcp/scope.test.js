// @ts-check
import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '../../src/mcp/allowlist.js';
import {
  buildScope,
  checkConfluenceContent,
  checkRepoArguments,
  checkSearchCode,
  checkToolScope,
  SCOPED_ARGUMENTS,
} from '../../src/mcp/scope.js';
import { SERVER_KEYS } from '../../src/mcp/servers.js';
import { readDiscoveredTools } from '../helpers/discovery-doc.js';

const SCOPE = buildScope({
  repos: ['Acme/App', 'acme/docs'],
  spaceKeys: ['ENG', 'Prod'],
  siteUrl: 'https://Acme.atlassian.net/',
});

/**
 * Runs a check and reduces its result to "ok" or the denial code.
 * @param {(args: unknown, scope: import('../../src/mcp/scope.js').Scope) => import('../../src/mcp/scope.js').ScopeResult} check
 *   The check to run.
 * @param {unknown} args - The tool arguments.
 * @returns {string} "ok", or the denial code.
 */
function verdict(check, args) {
  const result = check(args, SCOPE);
  return result.ok ? 'ok' : result.code;
}

describe('buildScope', () => {
  it('lower-cases repos and space keys so matching ignores case', () => {
    expect([...SCOPE.repos]).toEqual(['acme/app', 'acme/docs']);
    expect([...SCOPE.spaceKeys]).toEqual(['eng', 'prod']);
  });

  it('reduces the site URL to a lower-case origin', () => {
    expect(SCOPE.siteUrl).toBe('https://acme.atlassian.net');
  });
});

describe('checkRepoArguments', () => {
  it.each([
    { owner: 'acme', repo: 'app' },
    { owner: 'ACME', repo: 'App' },
    { owner: 'acme', repo: 'docs', path: 'README.md', ref: 'main' },
  ])('allows %j', (args) => {
    expect(verdict(checkRepoArguments, args)).toBe('ok');
  });

  it.each([
    [{ owner: 'acme', repo: 'secrets' }, 'repo-not-allowed'],
    [{ owner: 'evil', repo: 'app' }, 'repo-not-allowed'],
    [{ owner: ' acme', repo: 'app' }, 'repo-not-allowed'],
    [{ owner: 'acme', repo: 'app/../secrets' }, 'repo-not-allowed'],
    [{ owner: 'acme/app', repo: '' }, 'repo-missing'],
    [{ owner: 'acme' }, 'repo-missing'],
    [{ repo: 'app' }, 'repo-missing'],
    [{ owner: '', repo: 'app' }, 'repo-missing'],
    [{ owner: 'acme', repo: '   ' }, 'repo-missing'],
    [{ owner: 1, repo: 'app' }, 'repo-missing'],
    [{ owner: ['acme'], repo: 'app' }, 'repo-missing'],
    [{}, 'repo-missing'],
    [undefined, 'repo-missing'],
    [null, 'repo-missing'],
    [['acme', 'app'], 'repo-missing'],
    ['acme/app', 'repo-missing'],
  ])('refuses %j with %s', (args, code) => {
    expect(verdict(checkRepoArguments, args)).toBe(code);
  });

  it('names the repository it refused', () => {
    expect(checkRepoArguments({ owner: 'evil', repo: 'x' }, SCOPE)).toEqual({
      ok: false,
      code: 'repo-not-allowed',
      reason: 'Repository evil/x is not in the allowed list.',
    });
  });
});

describe('checkSearchCode', () => {
  it.each([
    'retry repo:acme/app',
    'repo:acme/app retry',
    'REPO:Acme/App retry',
    'repo:acme/app repo:acme/docs webhook',
    'retry repo:acme/app -repo:acme/docs',
    'retry repo:acme/app -repo:evil/other',
    'path:src (retry OR_NOT) repo:acme/app',
    'language:go repo:acme/app NOT test',
    '"repo:evil/x is just a phrase" repo:acme/app',
    'repo:"acme/app" retry',
  ])('allows %j', (query) => {
    expect(verdict(checkSearchCode, { query })).toBe('ok');
  });

  it.each([
    ['retry', 'query-no-repo'],
    ['path:src retry', 'query-no-repo'],
    ['-repo:acme/app retry', 'query-no-repo'],
    ['()', 'query-no-repo'],
    ['( ( ) )', 'query-no-repo'],
    ['"repo:acme/app" retry', 'query-no-repo'],
    ['retry repo:evil/x', 'query-repo-not-allowed'],
    ['repo:acme/app repo:evil/x', 'query-repo-not-allowed'],
    ['repo:acme/*', 'query-repo-not-allowed'],
    ['repo:acme/app,evil/x', 'query-repo-not-allowed'],
    ['repo:acme', 'query-repo-not-allowed'],
    ['x"y repo:evil/z"', 'query-repo-not-allowed'],
    ['retry org:acme', 'query-widens'],
    ['retry user:someone repo:acme/app', 'query-widens'],
    ['retry -org:evil repo:acme/app', 'query-widens'],
    ['retry ORG:acme repo:acme/app', 'query-widens'],
    ['retry repo:acme/app OR evil', 'query-or'],
    ['retry repo:acme/app or evil', 'query-or'],
    ['(retry OR evil) repo:acme/app', 'query-or'],
    ['retry OR(evil) repo:acme/app', 'query-or'],
    ['retry OR repo:acme/app', 'query-or'],
    ['', 'query-missing'],
    ['   ', 'query-missing'],
  ])('refuses %j with %s', (query, code) => {
    expect(verdict(checkSearchCode, { query })).toBe(code);
  });

  it.each([undefined, null, 42, ['repo:acme/app'], {}])('refuses a query of %j', (query) => {
    expect(verdict(checkSearchCode, { query })).toBe('query-missing');
  });

  it('refuses missing arguments', () => {
    expect(verdict(checkSearchCode, undefined)).toBe('query-missing');
  });

  it('tells the model how to scope the search', () => {
    expect(checkSearchCode({ query: 'retry' }, SCOPE)).toEqual({
      ok: false,
      code: 'query-no-repo',
      reason: 'Add a repo:owner/name qualifier for an allowed repository.',
    });
  });
});

describe('checkConfluenceContent', () => {
  const base = 'https://acme.atlassian.net/wiki/spaces';
  // Schemes built from variables because the tests need insecure ones on purpose, to prove they are refused.
  const INSECURE = 'http';
  const OTHER_SCHEME = 'ftp';

  it.each([
    `${base}/ENG/pages/123/Retry+policy`,
    `${base}/eng/pages/123`,
    `${base}/Prod/pages/9/Title?focusedCommentId=5#anchor`,
    'https://ACME.atlassian.net/wiki/spaces/ENG/pages/123',
    `${base}/%45NG/pages/123`,
    `${base}/ENG/overview`,
  ])('allows %j', (contentUrl) => {
    expect(verdict(checkConfluenceContent, { cloudId: 'c', content_url: contentUrl })).toBe('ok');
  });

  it.each([
    [`${base}/HR/pages/123/Salaries`, 'content-space-not-allowed'],
    [`${base}/ENGX/pages/123`, 'content-space-not-allowed'],
    [`${base}/%48R/pages/123`, 'content-space-not-allowed'],
    [`${base}/%E0%A4%A/pages/123`, 'content-space-not-allowed'],
    [`${base}/ENG/../HR/pages/123`, 'content-space-not-allowed'],
    [`${base}/ENG/%2e%2e/HR/pages/123`, 'content-space-not-allowed'],
    [`${base}/ENG/%2E%2E/%2E%2E/spaces/HR/pages/1`, 'content-space-not-allowed'],
    ['https://evil.atlassian.net/wiki/spaces/ENG/pages/123', 'content-site'],
    ['https://acme.atlassian.net.evil.example/wiki/spaces/ENG/pages/1', 'content-site'],
    ['https://acme.atlassian.net:8443/wiki/spaces/ENG/pages/1', 'content-site'],
    [`${INSECURE}://acme.atlassian.net/wiki/spaces/ENG/pages/123`, 'content-url'],
    ['https://user:pass@acme.atlassian.net/wiki/spaces/ENG/pages/1', 'content-url'],
    ['https://user@acme.atlassian.net/wiki/spaces/ENG/pages/1', 'content-url'],
    [`${OTHER_SCHEME}://acme.atlassian.net/wiki/spaces/ENG/pages/1`, 'content-url'],
    ['not a url', 'content-url'],
    ['/wiki/spaces/ENG/pages/1', 'content-url'],
    ['', 'content-url'],
    ['https://acme.atlassian.net/wiki/x/AbC', 'content-space'],
    ['https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=1', 'content-space'],
    ['https://acme.atlassian.net/wiki/spaces/ENG', 'content-space'],
    ['https://acme.atlassian.net/spaces/ENG/pages/1', 'content-space'],
    ['https://acme.atlassian.net/wiki/other/wiki/spaces/ENG/pages/1', 'content-space'],
  ])('refuses %j with %s', (contentUrl, code) => {
    expect(verdict(checkConfluenceContent, { cloudId: 'c', content_url: contentUrl })).toBe(code);
  });

  it.each([undefined, null, 42, ['x'], {}])('refuses a content_url of %j', (contentUrl) => {
    expect(verdict(checkConfluenceContent, { content_url: contentUrl })).toBe('content-url');
  });

  it.each(['123', 123, '', 0, ['1']])('refuses content_id %j', (contentId) => {
    expect(verdict(checkConfluenceContent, { content_id: contentId })).toBe('content-id');
  });

  it('refuses a content_id even when an allowed content_url comes with it', () => {
    const args = { content_id: '999', content_url: `${base}/ENG/pages/1` };

    expect(verdict(checkConfluenceContent, args)).toBe('content-id');
  });

  it('tells the model to use a URL from a search result', () => {
    expect(checkConfluenceContent({ content_id: '1' }, SCOPE)).toEqual({
      ok: false,
      code: 'content-id',
      reason: 'Use content_url, taken from a search result, instead of content_id.',
    });
  });

  it('refuses missing arguments', () => {
    expect(verdict(checkConfluenceContent, undefined)).toBe('content-url');
  });
});

describe('checkToolScope', () => {
  /** @type {Record<string, unknown>} */
  const allowed = {
    searchConfluence: { cloudId: 'c', cql: 'space = ENG' },
    getConfluenceContent: {
      cloudId: 'c',
      content_url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/1',
    },
    getAccessibleAtlassianResources: {},
    search_code: { query: 'x repo:acme/app' },
    get_file_contents: { owner: 'acme', repo: 'app', path: 'a' },
    get_commit: { owner: 'acme', repo: 'app', sha: 'abc' },
    list_commits: { owner: 'acme', repo: 'app' },
    list_releases: { owner: 'acme', repo: 'app' },
    get_latest_release: { owner: 'acme', repo: 'app' },
  };
  const everyAllowedTool = Object.entries(ALLOWLIST).flatMap(([server, tools]) =>
    tools.map((tool) => ({ server, tool })),
  );

  it.each(everyAllowedTool)(
    'has a scope rule for $server $tool, and it passes valid arguments',
    ({ server, tool }) => {
      expect(checkToolScope({ server, tool }, allowed[tool], SCOPE)).toEqual({ ok: true });
    },
  );

  it.each(everyAllowedTool.filter(({ tool }) => tool !== 'getAccessibleAtlassianResources'))(
    'has a scope rule for $server $tool that can refuse',
    ({ server, tool }) => {
      const result = checkToolScope({ server, tool }, { unrelated: true }, SCOPE);

      expect(result).toMatchObject({ ok: false });
      expect(result).not.toMatchObject({ code: 'no-scope-rule' });
    },
  );

  it('lets the resource lookup through, because it takes no arguments to scope', () => {
    const target = { server: SERVER_KEYS.atlassian, tool: 'getAccessibleAtlassianResources' };

    expect(checkToolScope(target, undefined, SCOPE)).toEqual({ ok: true });
  });

  it.each([
    [SERVER_KEYS.github, 'create_or_update_file'],
    [SERVER_KEYS.github, 'search_repositories'],
    [SERVER_KEYS.atlassian, 'executeRead'],
    [SERVER_KEYS.atlassian, 'search'],
    ['rogue', 'get_file_contents'],
    ['__proto__', 'toString'],
    [SERVER_KEYS.github, '__proto__'],
    [SERVER_KEYS.github, 'constructor'],
    [SERVER_KEYS.github, 'toString'],
  ])('refuses %s %s because it has no scope rule', (server, tool) => {
    expect(checkToolScope({ server, tool }, { owner: 'acme', repo: 'app' }, SCOPE)).toMatchObject({
      ok: false,
      code: 'no-scope-rule',
    });
  });
});

describe('the arguments the scope checks read exist in docs/mcp-tools.md', () => {
  const discovered = readDiscoveredTools();
  const checked = Object.entries(SCOPED_ARGUMENTS).flatMap(([tool, names]) =>
    names.map((name) => ({ tool, name })),
  );

  /**
   * Finds a tool's entry in the discovery file, whichever server it is on.
   * @param {string} tool - Bare tool name.
   * @returns {import('../helpers/discovery-doc.js').DiscoveredTool | undefined} Its entry.
   */
  const entryOf = (tool) => [...discovered.values()].map((tools) => tools.get(tool)).find(Boolean);

  it.each(checked)('$tool has an argument called $name', ({ tool, name }) => {
    expect(entryOf(tool)?.args.has(name)).toBe(true);
  });

  it('has a scope entry for exactly the allow-listed tools', () => {
    const allowListed = Object.values(ALLOWLIST).flat().sort();

    expect(Object.keys(SCOPED_ARGUMENTS).sort()).toEqual(allowListed);
  });

  it('knows that owner and repo are required for every GitHub repo tool', () => {
    const repoTools = [
      'get_file_contents',
      'get_commit',
      'list_commits',
      'list_releases',
      'get_latest_release',
    ];

    for (const tool of repoTools) {
      const args = discovered.get(SERVER_KEYS.github)?.get(tool)?.args;
      expect([args?.get('owner'), args?.get('repo')]).toEqual([true, true]);
    }
  });
});
