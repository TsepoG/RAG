// @ts-check
import { describe, expect, it } from 'vitest';
import { exchangeCode, refreshTokens } from '../../src/atlassian/tokenEndpoint.js';
import { AtlassianAuthError } from '../../src/errors/index.js';
import { CLIENT, fakeFetch, formOf, json, SERVER, tokenAnswer } from '../helpers/atlassian.js';

const CLOCK = { now: () => 1_000 };

describe('exchangeCode', () => {
  it('sends the code with the verifier, the redirect and the MCP resource', async () => {
    const { fetch, requests } = fakeFetch(() => tokenAnswer(1));

    await exchangeCode({
      fetch,
      tokenEndpoint: SERVER.tokenEndpoint,
      client: CLIENT,
      code: 'fake-code',
      verifier: 'fake-verifier',
      clock: CLOCK,
    });

    expect(requests[0].url).toBe(SERVER.tokenEndpoint);
    expect(formOf(requests[0])).toEqual({
      grant_type: 'authorization_code',
      code: 'fake-code',
      redirect_uri: CLIENT.redirectUri,
      client_id: CLIENT.clientId,
      code_verifier: 'fake-verifier',
      resource: 'https://mcp.atlassian.com/v2/mcp',
    });
  });

  it('returns the tokens, expiring from when they arrived', async () => {
    const { fetch } = fakeFetch(() => tokenAnswer(1));

    const result = await exchangeCode({
      fetch,
      tokenEndpoint: SERVER.tokenEndpoint,
      client: CLIENT,
      code: 'c',
      verifier: 'v',
      clock: CLOCK,
    });

    expect(result).toEqual({
      ok: true,
      tokens: {
        accessToken: 'fake-access-token-1',
        refreshToken: 'fake-refresh-token-1',
        expiresAt: 1_000 + 28_800_000,
        scopes: [
          'offline_access',
          'read:confluence:agent-interface',
          'search:confluence:agent-interface',
        ],
      },
    });
  });

  it('returns a refusal as its status and OAuth error code only', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'invalid_grant', error_description: 'fake-code was used' }, 400),
    );

    const result = await exchangeCode({
      fetch,
      tokenEndpoint: SERVER.tokenEndpoint,
      client: CLIENT,
      code: 'c',
      verifier: 'v',
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: false, status: 400, error: 'invalid_grant' });
  });

  it('refuses a 2xx answer that is not a usable token', async () => {
    const { fetch } = fakeFetch(() => json({ access_token: 'fake' }));

    await expect(
      exchangeCode({
        fetch,
        tokenEndpoint: SERVER.tokenEndpoint,
        client: CLIENT,
        code: 'c',
        verifier: 'v',
        clock: CLOCK,
      }),
    ).rejects.toThrow(AtlassianAuthError);
  });
});

describe('refreshTokens', () => {
  it('sends the refresh token as the public client, for the MCP resource', async () => {
    const { fetch, requests } = fakeFetch(() => tokenAnswer(2));

    const result = await refreshTokens({
      fetch,
      tokenEndpoint: SERVER.tokenEndpoint,
      clientId: CLIENT.clientId,
      refreshToken: 'fake-refresh-token-1',
      clock: CLOCK,
    });

    expect(formOf(requests[0])).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'fake-refresh-token-1',
      client_id: CLIENT.clientId,
      resource: 'https://mcp.atlassian.com/v2/mcp',
    });
    expect(result.ok && result.tokens.refreshToken).toBe('fake-refresh-token-2');
  });
});
