// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { createSessionTokens } from '../../src/conversation/sessionToken.js';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { ALLOWLIST, buildMcpServers, SERVER_KEYS } from '../../src/mcp/index.js';
import { FAKE_CLOUD_ID, validEnv } from '../helpers/env.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const HOUR = 3_600_000;
const GH_CLI = Object.freeze({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined });
const OAUTH = Object.freeze({
  ATLASSIAN_AUTH_MODE: 'oauth',
  ATLASSIAN_EMAIL: undefined,
  ATLASSIAN_API_TOKEN: undefined,
  ATLASSIAN_CLOUD_ID: FAKE_CLOUD_ID,
});

/**
 * A keeper over fake providers, and a conversation whose session can be swapped in.
 * @param {object} options - The providers' answers.
 * @param {string[]} options.github - What the CLI hands out, in turn (the last repeats).
 * @param {string[]} [options.atlassian] - What the Atlassian provider hands out, in oauth mode.
 * @returns {{ keeper: ReturnType<typeof createSessionTokens>, getGithubToken: import('vitest').Mock, conversation: any, restartServer: import('vitest').Mock, withSession: () => void, config: import('../../src/config/index.js').AppConfig, lines: () => Array<Record<string, unknown>> }} The pieces.
 */
function setup({ github, atlassian }) {
  const config = loadConfig(validEnv({ ...GH_CLI, ...(atlassian === undefined ? {} : OAUTH) }));
  let githubCalls = 0;
  let atlassianCalls = 0;
  const getGithubToken = vi.fn(async () => github[Math.min(githubCalls++, github.length - 1)]);
  const atlassianTokens =
    atlassian === undefined
      ? undefined
      : {
          getAtlassianToken: vi.fn(async () => ({
            accessToken: atlassian[Math.min(atlassianCalls++, atlassian.length - 1)],
            expiresAt: Date.now() + 8 * HOUR,
          })),
        };
  const restartServer = vi.fn(async () => undefined);
  /** @type {unknown} */
  let session;
  const conversation = { session: () => session };
  const { stream, lines } = createMemoryStream();
  const keeper = createSessionTokens({
    atlassianTokens,
    githubTokens: { getGithubToken },
    config,
    logger: createLogger({ destination: stream }),
  });
  const withSession = () => {
    session = { rpc: { mcp: { restartServer } } };
  };
  return { keeper, getGithubToken, conversation, restartServer, withSession, config, lines };
}

describe('createSessionTokens in gh-cli mode', () => {
  it('asks the CLI afresh for the token the session is made with', async () => {
    const { keeper, getGithubToken, conversation } = setup({ github: ['gho_fake1'] });

    await keeper.prepare(conversation);

    expect(getGithubToken).toHaveBeenCalledWith({ fresh: true });
    expect(keeper.tokensFor(conversation)).toEqual({
      atlassianToken: undefined,
      githubToken: 'gho_fake1',
    });
    expect(keeper.tokenFor(conversation)).toBeUndefined();
  });

  it('asks the CLI afresh before every turn, and leaves the session alone when nothing changed', async () => {
    const { keeper, getGithubToken, conversation, restartServer, withSession } = setup({
      github: ['gho_fake1'],
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    expect(getGithubToken).toHaveBeenCalledTimes(2);
    expect(getGithubToken).toHaveBeenLastCalledWith({ fresh: true });
    expect(restartServer).not.toHaveBeenCalled();
  });

  it('swaps a new login into the live session, keeping the tools and the time limit', async () => {
    const { keeper, conversation, restartServer, withSession, config, lines } = setup({
      github: ['gho_fake1', 'gho_fake2'],
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    const original = buildMcpServers(config, ALLOWLIST, { githubToken: 'gho_fake1' })[
      SERVER_KEYS.github
    ];
    expect(restartServer).toHaveBeenCalledExactlyOnceWith({
      serverName: SERVER_KEYS.github,
      config: {
        ...original,
        headers: { ...original.headers, Authorization: 'Bearer gho_fake2' },
      },
    });
    expect(keeper.tokensFor(conversation).githubToken).toBe('gho_fake2');
    expect(lines().map(({ msg }) => msg)).toEqual([
      'gave the conversation a renewed GitHub CLI login',
    ]);
    expect(JSON.stringify(lines())).not.toContain('gho_fake');
  });

  it('refuses the turn when the CLI has logged out, and swaps nothing', async () => {
    const { keeper, getGithubToken, conversation, restartServer, withSession } = setup({
      github: ['gho_fake1'],
    });
    await keeper.prepare(conversation);
    withSession();
    getGithubToken.mockRejectedValueOnce(new GithubSignInRequiredError('logged-out'));

    await expect(keeper.prepare(conversation)).rejects.toThrow(GithubSignInRequiredError);
    expect(restartServer).not.toHaveBeenCalled();
    expect(keeper.tokensFor(conversation).githubToken).toBe('gho_fake1');
  });
});

describe('createSessionTokens with both oauth and gh-cli', () => {
  it('swaps both servers in one turn, each with its own entry', async () => {
    const { keeper, conversation, restartServer, withSession, config } = setup({
      github: ['gho_fake1', 'gho_fake2'],
      atlassian: ['fake-atlassian-1', 'fake-atlassian-2'],
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    const servers = buildMcpServers(config, ALLOWLIST, {
      atlassianToken: 'fake-atlassian-2',
      githubToken: 'gho_fake2',
    });
    expect(restartServer.mock.calls).toEqual([
      [{ serverName: SERVER_KEYS.atlassian, config: servers[SERVER_KEYS.atlassian] }],
      [{ serverName: SERVER_KEYS.github, config: servers[SERVER_KEYS.github] }],
    ]);
    expect(keeper.tokensFor(conversation)).toEqual({
      atlassianToken: 'fake-atlassian-2',
      githubToken: 'gho_fake2',
    });
  });

  it('swaps only the server whose token changed', async () => {
    const { keeper, conversation, restartServer, withSession } = setup({
      github: ['gho_fake1', 'gho_fake2'],
      atlassian: ['fake-atlassian-1'],
    });
    await keeper.prepare(conversation);
    withSession();

    await keeper.prepare(conversation);

    expect(restartServer).toHaveBeenCalledOnce();
    expect(restartServer.mock.calls[0][0].serverName).toBe(SERVER_KEYS.github);
  });
});
