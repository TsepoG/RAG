// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { McpError } from '../../src/errors/index.js';
import {
  collectToolReport,
  listServerTools,
  renderToolsMarkdown,
} from '../../src/mcp/discovery.js';

const ENDPOINT = { url: 'https://mcp.example/v1', headers: { Authorization: 'x' }, timeout: 5000 };

/**
 * Builds a fake client whose listTools returns the given pages in order.
 * @param {Array<{ tools: import('../../src/mcp/discovery.js').ListedTool[], nextCursor?: string }>} pages
 *   Pages to return.
 * @returns {{ listTools: import('vitest').Mock, close: import('vitest').Mock }} The fake client.
 */
function fakeClient(pages) {
  const listTools = vi.fn();
  pages.forEach((page) => listTools.mockResolvedValueOnce(page));
  return { listTools, close: vi.fn().mockResolvedValue(undefined) };
}

describe('listServerTools', () => {
  it('returns the tools of a single page', async () => {
    const client = fakeClient([{ tools: [{ name: 'search' }, { name: 'get_file_contents' }] }]);

    const tools = await listServerTools('github_repos', ENDPOINT, async () => client);

    expect(tools.map((tool) => tool.name)).toEqual(['search', 'get_file_contents']);
  });

  it('follows the cursor across pages', async () => {
    const client = fakeClient([
      { tools: [{ name: 'a' }], nextCursor: 'page-2' },
      { tools: [{ name: 'b' }], nextCursor: 'page-3' },
      { tools: [{ name: 'c' }] },
    ]);

    const tools = await listServerTools('atlassian', ENDPOINT, async () => client);

    expect(tools.map((tool) => tool.name)).toEqual(['a', 'b', 'c']);
    expect(client.listTools.mock.calls.map(([params]) => params)).toEqual([
      undefined,
      { cursor: 'page-2' },
      { cursor: 'page-3' },
    ]);
  });

  it('passes the per-request timeout to every call', async () => {
    const client = fakeClient([{ tools: [] }]);

    await listServerTools('atlassian', ENDPOINT, async () => client);

    expect(client.listTools).toHaveBeenCalledWith(undefined, { timeout: 5000 });
  });

  it('connects to the endpoint it was given', async () => {
    const connect = vi.fn(async () => fakeClient([{ tools: [] }]));

    await listServerTools('atlassian', ENDPOINT, connect);

    expect(connect).toHaveBeenCalledExactlyOnceWith(ENDPOINT);
  });

  it('closes the client after a successful listing', async () => {
    const client = fakeClient([{ tools: [] }]);

    await listServerTools('atlassian', ENDPOINT, async () => client);

    expect(client.close).toHaveBeenCalledOnce();
  });

  it('closes the client and wraps the error when listing fails', async () => {
    const cause = new Error('HTTP 401');
    const client = { listTools: vi.fn().mockRejectedValue(cause), close: vi.fn() };

    const failure = await listServerTools('atlassian', ENDPOINT, async () => client).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(McpError);
    expect(failure.message).toBe('Could not list the tools of the "atlassian" MCP server');
    expect(failure.cause).toBe(cause);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('wraps an error from connecting', async () => {
    const cause = new Error('ECONNREFUSED');

    const failure = await listServerTools('github_repos', ENDPOINT, async () => {
      throw cause;
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(McpError);
    expect(failure.cause).toBe(cause);
  });

  it('gives up when a server never stops returning pages', async () => {
    const endless = {
      listTools: vi.fn().mockResolvedValue({ tools: [], nextCursor: 'more' }),
      close: vi.fn(),
    };

    const failure = await listServerTools('atlassian', ENDPOINT, async () => endless).catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(McpError);
    expect(failure.cause).toBeInstanceOf(McpError);
    expect(failure.cause.message).toBe('The server returned more than 20 pages of tools');
    expect(endless.close).toHaveBeenCalledOnce();
  });
});

describe('collectToolReport', () => {
  const servers = {
    atlassian: { url: 'https://mcp.example/atlassian' },
    github_repos: { url: 'https://mcp.example/github' },
  };

  /**
   * Connects each server to a fake client with its own tools.
   * @returns {import('../../src/mcp/discovery.js').Connect} A connect function.
   */
  function connectByUrl() {
    /** @type {Record<string, import('../../src/mcp/discovery.js').ListedTool[]>} */
    const toolsByUrl = {
      'https://mcp.example/atlassian': [
        { name: 'createConfluencePage', description: 'Creates a page' },
        {
          name: 'search',
          description: 'Searches',
          annotations: { readOnlyHint: true },
          inputSchema: { properties: { query: {}, limit: {} }, required: ['query'] },
        },
      ],
      'https://mcp.example/github': [
        {
          name: 'get_file_contents',
          inputSchema: {
            properties: { owner: {}, repo: {}, ref: {} },
            required: ['owner', 'repo'],
          },
        },
      ],
    };
    return async ({ url }) => fakeClient([{ tools: toolsByUrl[url] }]);
  }

  it('reports each server in the order given, with its URL', async () => {
    const report = await collectToolReport(servers, connectByUrl());

    expect(report.map(({ key, url }) => ({ key, url }))).toEqual([
      { key: 'atlassian', url: 'https://mcp.example/atlassian' },
      { key: 'github_repos', url: 'https://mcp.example/github' },
    ]);
  });

  it('classifies each tool and sorts them by name', async () => {
    const [atlassian, github] = await collectToolReport(servers, connectByUrl());

    expect(atlassian.tools).toEqual([
      {
        name: 'createConfluencePage',
        description: 'Creates a page',
        args: [],
        kind: 'write',
        reason: 'name contains the write verb "create"',
      },
      {
        name: 'search',
        description: 'Searches',
        args: [
          { name: 'query', required: true },
          { name: 'limit', required: false },
        ],
        kind: 'read',
        reason: 'no write verb in the name',
      },
    ]);
    expect(github.tools[0]).toMatchObject({
      name: 'get_file_contents',
      description: '',
      kind: 'read',
    });
  });

  it('reads argument names from the input schema and marks the required ones', async () => {
    const [, github] = await collectToolReport(servers, connectByUrl());

    expect(github.tools[0].args).toEqual([
      { name: 'owner', required: true },
      { name: 'repo', required: true },
      { name: 'ref', required: false },
    ]);
  });

  it('treats every argument as optional when the schema has no required list', async () => {
    const connect = async () =>
      fakeClient([{ tools: [{ name: 'search', inputSchema: { properties: { query: {} } } }] }]);

    const [report] = await collectToolReport({ atlassian: { url: 'u' } }, connect);

    expect(report.tools[0].args).toEqual([{ name: 'query', required: false }]);
  });

  it('reports no arguments for a tool with no schema or no properties', async () => {
    const connect = async () =>
      fakeClient([{ tools: [{ name: 'a' }, { name: 'b', inputSchema: {} }] }]);

    const [report] = await collectToolReport({ atlassian: { url: 'u' } }, connect);

    expect(report.tools.map((tool) => tool.args)).toEqual([[], []]);
  });

  it('collapses multi-line descriptions and escapes pipes', async () => {
    const connect = async () =>
      fakeClient([{ tools: [{ name: 'search', description: 'Line one.\n\n  Line | two.' }] }]);

    const [report] = await collectToolReport({ atlassian: { url: 'u' } }, connect);

    expect(report.tools[0].description).toBe('Line one. Line \\| two.');
  });

  it('shortens long descriptions', async () => {
    const connect = async () =>
      fakeClient([{ tools: [{ name: 'search', description: 'word '.repeat(100) }] }]);

    const [report] = await collectToolReport({ atlassian: { url: 'u' } }, connect);

    expect(report.tools[0].description).toHaveLength(160);
    expect(report.tools[0].description.endsWith('…')).toBe(true);
  });

  it('fails with the server named when one cannot be listed', async () => {
    const connect = async () => {
      throw new Error('boom');
    };

    await expect(collectToolReport(servers, connect)).rejects.toThrow(
      'Could not list the tools of the "atlassian" MCP server',
    );
  });
});

describe('renderToolsMarkdown', () => {
  const report = [
    {
      key: 'atlassian',
      url: 'https://mcp.example/atlassian',
      tools: [
        {
          name: 'createPage',
          description: 'Creates',
          args: [],
          kind: /** @type {const} */ ('write'),
          reason: 'name contains the write verb "create"',
        },
        {
          name: 'search',
          description: 'Searches | text',
          args: [
            { name: 'query', required: true },
            { name: 'limit', required: false },
          ],
          kind: /** @type {const} */ ('read'),
          reason: 'no write verb in the name',
        },
      ],
    },
    { key: 'github_repos', url: 'https://mcp.example/github', tools: [] },
  ];

  it.each([
    [
      'says when and how it was generated',
      'Generated 2026-10-10T12:00:00.000Z by `npm run mcp:tools`',
    ],
    [
      'gives each server a heading, its URL and a count of read and write tools',
      '## atlassian\n\nURL: https://mcp.example/atlassian\n\n2 tools: 1 read, 1 write.',
    ],
    [
      'has a table header with an Arguments column',
      '| Tool | Class | Why | Arguments | Description |',
    ],
    [
      'shows a write tool with no arguments',
      '| `createPage` | write | name contains the write verb "create" | none | Creates |',
    ],
    [
      'lists argument names, marking required ones with an asterisk',
      '| `search` | read | no write verb in the name | `query`*, `limit` | Searches | text |',
    ],
    ['explains the asterisk', '* marks a required argument'],
    [
      'says so when a server returned no tools',
      '## github_repos\n\nURL: https://mcp.example/github\n\n0 tools: 0 read, 0 write.\n\nNo tools returned.',
    ],
  ])('%s', (_description, fragment) => {
    expect(renderToolsMarkdown(report, '2026-10-10T12:00:00.000Z')).toContain(fragment);
  });

  it('ends with a newline-terminated section', () => {
    expect(renderToolsMarkdown(report, 'now').endsWith('\n')).toBe(true);
  });
});
