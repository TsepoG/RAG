// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { createSessionTokens } from '../../src/conversation/sessionToken.js';
import { AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { ALLOWLIST, buildMcpServers } from '../../src/mcp/index.js';
import { oauthEnv } from '../helpers/env.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const NOW = 1_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A keeper over a fake provider, and a conversation whose session can be swapped in.
 * @param {object} [options] - What to change.
 * @param {Record<string, string | undefined>} [options.env] - Environment overrides.
 * @param {() => Promise<{ accessToken: string, expiresAt: number }>} [options.token] - What the provider hands out.
 * @returns {{ keeper: ReturnType<typeof createSessionTokens>, getAtlassianToken: import('vitest').Mock, conversation: any, restartServer: import('vitest').Mock, withSession: () => void, config: import('../../src/config/index.js').AppConfig, lines: () => Array<Record<string, unknown>> }} The keeper and its doubles.
 */
function setup({
  env = {},
  token = async () => ({ accessToken: 'fake-token-1', expiresAt: NOW + 8 * HOUR }),
} = {}) {
  const config = loadConfig(oauthEnv(env));
  const getAtlassianToken = vi.fn(token);
  const restartServer = vi.fn(async () => undefined);
  /** @type {unknown} */
  let session;
  const conversation = { session: () => session };
  const { stream, lines } = createMemoryStream();
  const keeper = createSessionTokens({
    atlassianTokens: { getAtlassianToken },
    config,
    logger: createLogger({ destination: stream }),
  });
  const withSession = () => {
    session = { rpc: { mcp: { restartServer } } };
  };
  return { keeper, getAtlassianToken, conversation, restartServer, withSession, config, lines };
}

describe('createSessionTokens before the session exists', () => {
  it('asks for a token with three hours left, for the session to be made with', async () => {
    const { keeper, getAtlassianToken, conversation } = setup();

    await keeper.prepare(conversation);

    expect(getAtlassianToken).toHaveBeenCalledWith({ minValidityMs: 3 * HOUR });
    expect(keeper.tokenFor(conversation)).toBe('fake-token-1');
  });

  it('has no token for a conversation it has not prepared', () => {
    const { keeper, conversation } = setup();

    expect(keeper.tokenFor(conversation)).toBeUndefined();
  });

  it('passes on a missing sign-in', async () => {
    const { keeper, conversation } = setup({
      token: async () => {
        throw new AtlassianSignInRequiredError();
      },
    });

    await expect(keeper.prepare(conversation)).rejects.toThrow(AtlassianSignInRequiredError);
  });
});

describe('createSessionTokens once the session exists', () => {
  it('asks the provider before every turn, but leaves the session alone when the token is the same', async () => {
    const { keeper, getAtlassianToken, conversation, restartServer, withSession } = setup();
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    expect(getAtlassianToken).toHaveBeenCalledTimes(2);
    expect(getAtlassianToken).toHaveBeenLastCalledWith({ minValidityMs: 5 * MINUTE });
    expect(restartServer).not.toHaveBeenCalled();
  });

  it('follows the sign-in file, not its own note: a token renewed elsewhere is swapped in', async () => {
    let n = 0;
    const { keeper, conversation, restartServer, withSession } = setup({
      // Both tokens have hours left; the second was renewed in the file meanwhile.
      token: async () => {
        n += 1;
        return { accessToken: `fake-token-${n}`, expiresAt: NOW + 8 * HOUR };
      },
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    expect(restartServer).toHaveBeenCalledOnce();
    expect(keeper.tokenFor(conversation)).toBe('fake-token-2');
  });

  it('refuses the turn when the sign-in is gone, even if the session token still has hours left', async () => {
    let n = 0;
    const { keeper, conversation, restartServer, withSession } = setup({
      token: async () => {
        n += 1;
        if (n > 1) {
          throw new AtlassianSignInRequiredError();
        }
        return { accessToken: 'fake-token-1', expiresAt: NOW + 8 * HOUR };
      },
    });
    await keeper.prepare(conversation);
    withSession();

    await expect(keeper.prepare(conversation)).rejects.toThrow(AtlassianSignInRequiredError);
    expect(restartServer).not.toHaveBeenCalled();
  });

  it('renews a token that would run out during the turn, and swaps it into the live session', async () => {
    let n = 0;
    const { keeper, getAtlassianToken, conversation, restartServer, withSession, lines } = setup({
      token: async () => {
        n += 1;
        // The first token has four minutes left: less than the five-minute turn margin.
        return {
          accessToken: `fake-token-${n}`,
          expiresAt: NOW + (n === 1 ? 4 * MINUTE : 8 * HOUR),
        };
      },
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    expect(getAtlassianToken).toHaveBeenLastCalledWith({ minValidityMs: 5 * MINUTE });
    expect(restartServer).toHaveBeenCalledOnce();
    expect(keeper.tokenFor(conversation)).toBe('fake-token-2');
    expect(lines()).toEqual([
      expect.objectContaining({ msg: 'gave the conversation a renewed Atlassian sign-in' }),
    ]);
    expect(JSON.stringify(lines())).not.toContain('fake-token');
  });

  it('gives the restarted server the same entry as the original, apart from the Authorization header', async () => {
    let n = 0;
    const { keeper, conversation, restartServer, withSession, config } = setup({
      token: async () => {
        n += 1;
        return { accessToken: `fake-token-${n}`, expiresAt: NOW + MINUTE };
      },
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    const original = buildMcpServers(config, ALLOWLIST, {
      atlassianToken: 'fake-token-1',
    }).atlassian;
    const [{ serverName, config: replacement }] = /** @type {any} */ (restartServer.mock.calls[0]);
    expect(serverName).toBe('atlassian');
    expect({ ...replacement, headers: undefined }).toEqual({ ...original, headers: undefined });
    expect(replacement.headers).toEqual({ Authorization: 'Bearer fake-token-2' });
    expect(replacement.tools).toEqual(ALLOWLIST.atlassian);
    expect(replacement.timeout).toBe(config.mcp.timeoutMs);
  });

  it('keeps a turn margin of ASK_TIMEOUT_MS plus a minute when that is longer than five minutes', async () => {
    const { keeper, getAtlassianToken, conversation, withSession } = setup({
      env: { ASK_TIMEOUT_MS: '600000' },
      token: async () => ({ accessToken: 'fake-token', expiresAt: NOW + 10 * MINUTE }),
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    expect(getAtlassianToken).toHaveBeenLastCalledWith({ minValidityMs: 11 * MINUTE });
  });

  it('gives a session it never prepared a token', async () => {
    const { keeper, conversation, restartServer, withSession } = setup();
    withSession();

    await keeper.prepare(conversation);

    expect(restartServer).toHaveBeenCalledOnce();
  });

  it('keeps the old token when the restart fails, so the next turn tries again', async () => {
    const { keeper, conversation, restartServer, withSession } = setup({
      token: async () => ({ accessToken: 'fake-token', expiresAt: NOW + MINUTE }),
    });
    withSession();
    restartServer.mockRejectedValueOnce(new Error('restart failed'));

    await expect(keeper.prepare(conversation)).rejects.toThrow('restart failed');
    expect(keeper.tokenFor(conversation)).toBeUndefined();
  });
});
