// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import { PAGE, reply, WINDOW } from '../helpers/ask.js';
import { setupConversation } from '../helpers/conversation.js';

const GH_CLI = Object.freeze({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined });
const FIRST = { tools: [PAGE], reply: reply(`${WINDOW} [C1].`) };
const FAKE_CLI_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';

/**
 * A fake GitHub CLI token provider.
 * @param {() => Promise<string>} [token] - What it hands out.
 * @returns {{ getGithubToken: import('vitest').Mock, invalidate: import('vitest').Mock }} The fake.
 */
function cliTokens(token = async () => FAKE_CLI_TOKEN) {
  return { getGithubToken: vi.fn(token), invalidate: vi.fn() };
}

describe('a conversation in gh-cli mode', () => {
  it("makes its session with the GitHub CLI's token as a Bearer header, with the read-only headers", async () => {
    const githubTokens = cliTokens();
    const { ask, client } = await setupConversation({ turns: [FIRST], env: GH_CLI, githubTokens });

    await ask();

    expect(client.configs[0].mcpServers.github_repos.headers).toEqual({
      Authorization: `Bearer ${FAKE_CLI_TOKEN}`,
      'X-MCP-Readonly': 'true',
      'X-MCP-Toolsets': 'repos',
    });
    expect(githubTokens.getGithubToken).toHaveBeenCalledWith({ fresh: true });
  });

  it('refuses a question when the CLI is not logged in, using no turn and keeping the conversation', async () => {
    const { ask, conversation, client, endConversation } = await setupConversation({
      turns: [FIRST],
      env: GH_CLI,
      githubTokens: cliTokens(async () => {
        throw new GithubSignInRequiredError('logged-out');
      }),
    });

    await expect(ask()).rejects.toMatchObject({ reason: 'logged-out' });

    expect(conversation.turnCount()).toBe(0);
    expect(conversation.endedReason()).toBeUndefined();
    expect(client.createSession).not.toHaveBeenCalled();
    expect(endConversation).not.toHaveBeenCalled();
  });
});
