// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import { ask, PAGE, reply, WINDOW } from '../helpers/ask.js';

const GH_CLI = Object.freeze({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined });
const FAKE_CLI_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';

describe('askQuestion in gh-cli mode', () => {
  it("makes the session with the GitHub CLI's token and the read-only headers", async () => {
    const githubTokens = { getGithubToken: vi.fn(async () => FAKE_CLI_TOKEN), invalidate: vi.fn() };

    const { client } = await ask({
      replies: [reply(`${WINDOW} [C1].`)],
      tools: [PAGE],
      env: GH_CLI,
      githubTokens,
    });

    expect(client.configs[0].mcpServers.github_repos.headers).toEqual({
      Authorization: `Bearer ${FAKE_CLI_TOKEN}`,
      'X-MCP-Readonly': 'true',
      'X-MCP-Toolsets': 'repos',
    });
  });

  it('fails with the sign-in error, not a Copilot one, when the CLI is not logged in', async () => {
    const capture = /** @type {{ client?: any }} */ ({});

    const failure = ask({
      replies: ['unused'],
      env: GH_CLI,
      capture,
      githubTokens: {
        getGithubToken: async () => {
          throw new GithubSignInRequiredError('logged-out');
        },
        invalidate: vi.fn(),
      },
    });

    await expect(failure).rejects.toMatchObject({ reason: 'logged-out' });
    expect(capture.client.createSession).not.toHaveBeenCalled();
  });
});
