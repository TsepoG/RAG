// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { ask, PAGE, reply, WINDOW } from '../helpers/ask.js';
import { FAKE_CLOUD_ID } from '../helpers/env.js';

const OAUTH = Object.freeze({
  ATLASSIAN_AUTH_MODE: 'oauth',
  ATLASSIAN_EMAIL: undefined,
  ATLASSIAN_API_TOKEN: undefined,
  ATLASSIAN_CLOUD_ID: FAKE_CLOUD_ID,
});

describe('askQuestion in oauth mode', () => {
  it('makes the session with a signed-in token that has three hours left', async () => {
    const getAtlassianToken = vi.fn(async () => ({
      accessToken: 'fake-signed-in-token',
      expiresAt: Date.parse('2030-01-01T00:00:00Z'),
    }));

    const { client } = await ask({
      replies: [reply(`${WINDOW} [C1].`)],
      tools: [PAGE],
      env: OAUTH,
      getAtlassianToken,
    });

    expect(getAtlassianToken).toHaveBeenCalledWith({ minValidityMs: 3 * 60 * 60_000 });
    expect(client.configs[0].mcpServers.atlassian.headers).toEqual({
      Authorization: 'Bearer fake-signed-in-token',
    });
  });

  it('fails with the sign-in error, not a Copilot one, when there is no sign-in', async () => {
    const capture = /** @type {{ client?: any }} */ ({});

    const failure = ask({
      replies: ['unused'],
      env: OAUTH,
      capture,
      getAtlassianToken: async () => {
        throw new AtlassianSignInRequiredError();
      },
    });

    await expect(failure).rejects.toThrow(AtlassianSignInRequiredError);
    expect(capture.client.createSession).not.toHaveBeenCalled();
  });
});
