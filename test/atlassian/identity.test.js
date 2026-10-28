// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { checkSite, RESOURCES_TOOL } from '../../src/atlassian/identity.js';
import { AtlassianAuthError } from '../../src/errors/index.js';

const CLOUD_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SITE_URL = 'https://acme.atlassian.net';
const TOKEN = 'fake-access-token';

/**
 * The tool's answer for a list of sites, shaped as Atlassian sends it.
 * @param {Array<{ cloudId: string, url: string }>} resources - The sites.
 * @returns {{ content: Array<{ type: string, text: string }> }} The answer.
 */
function answer(resources) {
  const data = { resources: resources.map((site) => ({ ...site, products: [{}] })) };
  return { content: [{ type: 'text', text: JSON.stringify({ data }) }] };
}

/**
 * Runs the check against a fake MCP client.
 * @param {unknown | (() => Promise<unknown>)} result - What the tool returns, or a function that does.
 * @returns {{ run: () => ReturnType<typeof checkSite>, connect: import('vitest').Mock, callTool: import('vitest').Mock, close: import('vitest').Mock }} The run and its doubles.
 */
function setup(result) {
  /** @type {() => Promise<unknown>} */
  const toolCall =
    typeof result === 'function'
      ? /** @type {() => Promise<unknown>} */ (result)
      : async () => result;
  const callTool = vi.fn(toolCall);
  const close = vi.fn(async () => undefined);
  const connect = vi.fn(async () => ({ callTool, close }));
  const run = () =>
    checkSite({
      accessToken: TOKEN,
      cloudId: CLOUD_ID,
      siteUrl: SITE_URL,
      timeoutMs: 30_000,
      connect: /** @type {Parameters<typeof checkSite>[0]['connect']} */ (
        /** @type {unknown} */ (connect)
      ),
    });
  return { run, connect, callTool, close };
}

describe('checkSite', () => {
  it('calls the tool over MCP with the new token, not through Copilot', async () => {
    const { run, connect, callTool, close } = setup(answer([{ cloudId: CLOUD_ID, url: SITE_URL }]));

    await run();

    expect(connect).toHaveBeenCalledWith({
      url: 'https://mcp.atlassian.com/v2/mcp',
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeout: 30_000,
    });
    expect(callTool).toHaveBeenCalledWith({ name: RESOURCES_TOOL, arguments: {} });
    expect(close).toHaveBeenCalledOnce();
  });

  it('finds the configured site among those the account can reach', async () => {
    const { run } = setup(
      answer([
        { cloudId: 'other-cloud', url: 'https://other.atlassian.net' },
        { cloudId: CLOUD_ID, url: 'https://ACME.atlassian.net/' },
      ]),
    );

    expect(await run()).toEqual({ ok: true, siteHost: 'acme.atlassian.net' });
  });

  it.each([
    ['another site only', [{ cloudId: 'other-cloud', url: 'https://other.atlassian.net' }]],
    [
      'the right cloud id at another address',
      [{ cloudId: CLOUD_ID, url: 'https://other.atlassian.net' }],
    ],
    ['the right address with another cloud id', [{ cloudId: 'other-cloud', url: SITE_URL }]],
    ['an address that is not a URL', [{ cloudId: CLOUD_ID, url: 'acme' }]],
    ['no site at all', []],
  ])('says the account cannot reach the site when it can reach %s', async (_label, sites) => {
    expect(await setup(answer(sites)).run()).toEqual({ ok: false, reason: 'wrong-site' });
  });

  it.each([
    [
      'an error result',
      { isError: true, content: [{ type: 'text', text: '{"data":{"resources":[]}}' }] },
    ],
    ['no text', { content: [{ type: 'image' }] }],
    ['text that is not JSON', { content: [{ type: 'text', text: 'Bearer fake-access-token' }] }],
    ['JSON of another shape', { content: [{ type: 'text', text: '{"sites":[]}' }] }],
    ['not a tool result', 'oops'],
  ])('fails clearly on %s, without quoting it, and still closes', async (_label, result) => {
    const { run, close } = setup(result);

    const failure = run();

    await expect(failure).rejects.toThrow(
      new AtlassianAuthError('failed', 'Atlassian did not say which sites this account can reach'),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails clearly when the tool call fails, and still closes', async () => {
    const { run, close } = setup(async () => {
      throw new Error('HTTP 500: fake body');
    });

    await expect(run()).rejects.toThrow('Atlassian did not say which sites this account can reach');
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails clearly, without the MCP client message, when the server cannot be reached', async () => {
    const connect = vi.fn(async () => {
      throw new Error('Error POSTing to endpoint (HTTP 401): fake body');
    });

    const failure = checkSite({
      accessToken: TOKEN,
      cloudId: CLOUD_ID,
      siteUrl: SITE_URL,
      timeoutMs: 30_000,
      connect: /** @type {Parameters<typeof checkSite>[0]['connect']} */ (connect),
    });

    await expect(failure).rejects.toThrow(AtlassianAuthError);
    await expect(failure).rejects.not.toHaveProperty('cause');
    await expect(failure).rejects.not.toThrow('fake body');
  });
});
