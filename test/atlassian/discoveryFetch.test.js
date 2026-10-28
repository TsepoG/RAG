// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscovery } from '../../src/atlassian/discovery.js';
import { AtlassianAuthError } from '../../src/errors/index.js';
import { fakeFetch, ISSUER, json, SERVER } from '../helpers/atlassian.js';

const RESOURCE = 'https://mcp.atlassian.com/v2/mcp';

/**
 * Answers the two metadata documents the way Atlassian does.
 * @param {import('../helpers/atlassian.js').SeenRequest} request - The request.
 * @returns {Response} The answer.
 */
function atlassian({ url }) {
  if (url === 'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp') {
    return json({ resource: RESOURCE, authorization_servers: [ISSUER] });
  }
  if (url === 'https://auth.atlassian.com/.well-known/oauth-authorization-server/tenant-id') {
    return json({
      issuer: ISSUER,
      authorization_endpoint: SERVER.authorizationEndpoint,
      token_endpoint: SERVER.tokenEndpoint,
      revocation_endpoint: SERVER.revocationEndpoint,
      registration_endpoint: SERVER.registrationEndpoint,
      code_challenge_methods_supported: ['S256'],
    });
  }
  return json({}, 404);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createDiscovery', () => {
  it('reads the MCP server metadata, then the authorization server it names', async () => {
    const { fetch, requests } = fakeFetch(atlassian);

    const server = await createDiscovery({ fetch }).authorizationServer();

    expect(server).toEqual(SERVER);
    expect(requests.map(({ url }) => url)).toEqual([
      'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp',
      'https://auth.atlassian.com/.well-known/oauth-authorization-server/tenant-id',
    ]);
  });

  it('reads them once per process', async () => {
    const { fetch, requests } = fakeFetch(atlassian);
    const discovery = createDiscovery({ fetch });

    await discovery.authorizationServer();
    await discovery.authorizationServer();

    expect(requests).toHaveLength(2);
  });

  it('fails clearly when a document cannot be read, and tries again next time', async () => {
    let down = true;
    const { fetch } = fakeFetch((request) => (down ? json({}, 503) : atlassian(request)));
    const discovery = createDiscovery({ fetch });

    await expect(discovery.authorizationServer()).rejects.toThrow(
      new AtlassianAuthError('failed', 'Could not read the MCP server metadata (HTTP 503)'),
    );
    down = false;

    await expect(discovery.authorizationServer()).resolves.toEqual(SERVER);
  });

  it('uses the global fetch and the Atlassian MCP server by default', async () => {
    const { fetch, requests } = fakeFetch(atlassian);
    vi.stubGlobal('fetch', fetch);

    await createDiscovery().authorizationServer();

    expect(requests[0].url).toBe(
      'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp',
    );
  });
});
