// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { pageFingerprint } from '../../src/citations/index.js';
import { AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import {
  createMcpConfluenceChecker,
  DETAIL_ORDER,
  PAGE_TOOL,
  versionFromResult,
} from '../../src/recheck/confluenceMcp.js';
import { recheckSources } from '../../src/recheck/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { confluenceSource } from '../helpers/sources.js';

const CLOUD_ID = '11111111-2222-3333-4444-555555555555';
const SITE_URL = 'https://acme.atlassian.net';
const TOKEN = 'fake-signed-in-token';

/**
 * The tool's answer for a page at a version.
 * @param {string} id - The page id.
 * @param {number} [version] - Its version; left out, the answer has none.
 * @returns {{ content: Array<{ type: string, text: string }> }} The answer.
 */
function pageAnswer(id, version) {
  const metadata = version === undefined ? {} : { version: { number: version } };
  return { content: [{ type: 'text', text: JSON.stringify({ data: { id, metadata } }) }] };
}

/**
 * A page source read at version 3.
 * @param {Partial<import('../../src/citations/index.js').ConfluenceSource>} [overrides] - Fields to change.
 * @returns {import('../../src/citations/index.js').ConfluenceSource & { key: string }} The source.
 */
function page(overrides = {}) {
  return {
    ...confluenceSource({ id: '262439', version: 3, spaceKey: 'ENG', ...overrides }),
    fingerprint: pageFingerprint(3),
    key: 'C1',
  };
}

/**
 * A checker over a fake MCP connection.
 * @param {object} [options] - What to change.
 * @param {(args: any) => unknown} [options.answer] - What the tool returns for a call.
 * @param {() => Promise<{ accessToken: string, expiresAt: number }>} [options.token] - The token provider.
 * @param {() => Promise<void>} [options.close] - Closing the connection.
 * @returns {{ checker: ReturnType<typeof createMcpConfluenceChecker>, connect: import('vitest').Mock, callTool: import('vitest').Mock, close: import('vitest').Mock, lines: () => Array<Record<string, unknown>> }} The checker and its doubles.
 */
function setup({
  answer = () => pageAnswer('262439', 3),
  token = async () => ({ accessToken: TOKEN, expiresAt: Date.now() + 3_600_000 }),
  close = async () => undefined,
} = {}) {
  const callTool = vi.fn(async ({ arguments: args }) => answer(args));
  const closeMock = vi.fn(close);
  const connect = vi.fn(async () => ({ callTool, close: closeMock }));
  const { stream, lines } = createMemoryStream();
  const checker = createMcpConfluenceChecker({
    atlassian: { siteUrl: SITE_URL, cloudId: CLOUD_ID, spaceKeys: ['ENG', 'PAY'] },
    getAtlassianToken: token,
    connect: /** @type {any} */ (connect),
    timeoutMs: 30_000,
    logger: createLogger({ destination: stream }),
  });
  return { checker, connect, callTool, close: closeMock, lines };
}

describe('createMcpConfluenceChecker outcomes', () => {
  it('is unchanged when the live version is the one the model read', async () => {
    expect(await setup().checker.check(page())).toBe('unchanged');
  });

  it('is changed when the page has a newer version', async () => {
    const { checker } = setup({ answer: () => pageAnswer('262439', 4) });

    expect(await checker.check(page())).toBe('changed');
  });

  it('compares with the version it was fetched at when there is no fingerprint', async () => {
    const { checker } = setup({ answer: () => pageAnswer('262439', 3) });

    expect(await checker.check({ ...page(), fingerprint: undefined })).toBe('unchanged');
  });

  it.each([
    ['an error result', () => ({ isError: true, content: [{ type: 'text', text: 'Not found' }] })],
    ['another page', () => pageAnswer('999', 3)],
    ['no version even in full', () => pageAnswer('262439')],
    ['text that is not JSON', () => ({ content: [{ type: 'text', text: 'oops' }] })],
  ])(
    'cannot check a page when the tool returns %s, and never calls it changed',
    async (_label, answer) => {
      const { checker, lines } = setup({ answer });

      expect(await checker.check(page())).toBe('unavailable');
      expect(lines()).toContainEqual(
        expect.objectContaining({ msg: 'could not re-check a page over MCP' }),
      );
    },
  );

  it('cannot check a page when the tool call fails, logging only the reason', async () => {
    const { checker, lines } = setup({
      answer: () => {
        throw new TypeError('HTTP 500: fake body');
      },
    });

    expect(await checker.check(page())).toBe('unavailable');
    expect(lines()[0]).toMatchObject({ reason: 'TypeError' });
    expect(JSON.stringify(lines())).not.toContain('fake body');
  });
});

describe('createMcpConfluenceChecker requests', () => {
  it('connects to the MCP server with the signed-in token, not to the REST route', async () => {
    const { checker, connect } = setup();

    await checker.check(page());

    expect(connect).toHaveBeenCalledWith({
      url: 'https://mcp.atlassian.com/v2/mcp',
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeout: 30_000,
    });
  });

  it('asks for the summary only, with the configured cloud id and an address it builds itself', async () => {
    const { checker, callTool } = setup();

    await checker.check(page({ url: 'https://evil.example/wiki/spaces/ENG/pages/262439' }));

    expect(callTool.mock.calls).toEqual([
      [
        {
          name: PAGE_TOOL,
          arguments: {
            cloudId: CLOUD_ID,
            content_url: `${SITE_URL}/wiki/spaces/ENG/pages/262439`,
            detail: 'summary',
          },
        },
      ],
    ]);
    expect(PAGE_TOOL).toBe('getConfluenceContent');
  });

  it('reads the full page when the summary has no version', async () => {
    const { checker, callTool } = setup({
      answer: (args) =>
        args.detail === 'summary' ? pageAnswer('262439') : pageAnswer('262439', 3),
    });

    expect(await checker.check(page())).toBe('unchanged');
    expect(callTool.mock.calls.map(([call]) => call.arguments.detail)).toEqual([...DETAIL_ORDER]);
  });

  it.each([
    ['outside the allowed spaces', { spaceKey: 'SECRET' }],
    ['with an id that is not a number', { id: '../1' }],
  ])('never asks for a page %s', async (_label, overrides) => {
    const { checker, connect, lines } = setup();

    expect(await checker.check(page(overrides))).toBe('unavailable');
    expect(connect).not.toHaveBeenCalled();
    expect(lines()[0]).toMatchObject({
      msg: 'did not re-check a page: it is outside the allowed spaces or not reachable',
    });
  });
});

describe('createMcpConfluenceChecker connections', () => {
  it('opens one connection for a batch of pages and closes it afterwards', async () => {
    const { checker, connect, close } = setup({
      answer: (args) => pageAnswer(args.content_url.split('/').at(-1), 3),
    });
    const sources = ['1', '2', '3'].map((id, index) => ({ ...page({ id }), key: `C${index + 1}` }));

    const results = await recheckSources(sources, {
      confluence: checker,
      github: { check: vi.fn() },
      clock: { now: () => 1 },
    });

    expect(results.map(({ status }) => status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(connect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('opens no connection for a batch with nothing it may check', async () => {
    const { checker, connect } = setup();

    await checker.batch((pages) => pages.check(page({ spaceKey: 'SECRET' })));

    expect(connect).not.toHaveBeenCalled();
  });

  it('cannot check anything when nobody is signed in, and never logs a token', async () => {
    const { checker, connect, lines } = setup({
      token: async () => {
        throw new AtlassianSignInRequiredError();
      },
    });

    const statuses = await checker.batch((pages) =>
      Promise.all([pages.check(page()), pages.check(page({ id: '2' }))]),
    );

    expect(statuses).toEqual(['unavailable', 'unavailable']);
    expect(connect).not.toHaveBeenCalled();
    expect(lines()[0]).toMatchObject({ reason: 'AtlassianSignInRequiredError' });
  });

  it('still gives its results when closing the connection fails', async () => {
    const { checker, lines } = setup({
      close: async () => {
        throw new Error('already closed');
      },
    });

    expect(await checker.check(page())).toBe('unchanged');
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'could not close the re-check connection' }),
    );
  });

  it('logs an odd failure without details', async () => {
    const { checker, lines } = setup({
      answer: () => {
        throw 'odd';
      },
    });

    expect(await checker.check(page())).toBe('unavailable');
    expect(lines()[0]).toMatchObject({ reason: 'unknown' });
  });
});

describe('versionFromResult', () => {
  it.each([
    ['not an object', 'oops'],
    ['no content', {}],
    ['a version that is not a whole number', pageAnswer('1', 1.5)],
  ])('finds no version in %s', (_label, result) => {
    expect(versionFromResult(result, '1')).toBeUndefined();
  });
});
