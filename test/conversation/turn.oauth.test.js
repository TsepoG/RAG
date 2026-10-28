// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { AtlassianSignInRequiredError, ConversationBusyError } from '../../src/errors/index.js';
import { PAGE, reply, WINDOW } from '../helpers/ask.js';
import { setupConversation } from '../helpers/conversation.js';
import { FAKE_CLOUD_ID } from '../helpers/env.js';

const OAUTH = Object.freeze({
  ATLASSIAN_AUTH_MODE: 'oauth',
  ATLASSIAN_EMAIL: undefined,
  ATLASSIAN_API_TOKEN: undefined,
  ATLASSIAN_CLOUD_ID: FAKE_CLOUD_ID,
});
const FIRST = { tools: [PAGE], reply: reply(`${WINDOW} [C1].`) };

describe('a conversation in oauth mode', () => {
  it("makes its session with the signed-in person's token as a Bearer header", async () => {
    const getAtlassianToken = vi.fn(async () => ({
      accessToken: 'fake-signed-in-token',
      expiresAt: Date.parse('2030-01-01T00:00:00Z'),
    }));
    const { ask, client } = await setupConversation({
      turns: [FIRST],
      env: OAUTH,
      atlassianTokens: { getAtlassianToken },
    });

    await ask();

    expect(client.configs[0].mcpServers.atlassian.headers).toEqual({
      Authorization: 'Bearer fake-signed-in-token',
    });
  });

  it('refuses a question without a sign-in, using no turn and keeping the conversation', async () => {
    const { ask, conversation, client, endConversation } = await setupConversation({
      turns: [FIRST],
      env: OAUTH,
      atlassianTokens: {
        getAtlassianToken: vi.fn(async () => {
          throw new AtlassianSignInRequiredError();
        }),
      },
    });

    await expect(ask()).rejects.toThrow(AtlassianSignInRequiredError);

    expect(conversation.turnCount()).toBe(0);
    expect(conversation.endedReason()).toBeUndefined();
    expect(client.createSession).not.toHaveBeenCalled();
    expect(endConversation).not.toHaveBeenCalled();
  });

  it('exposes prepare for the route to call before streaming', async () => {
    const getAtlassianToken = vi.fn(async () => ({
      accessToken: 'fake-signed-in-token',
      expiresAt: Date.parse('2030-01-01T00:00:00Z'),
    }));
    const { runner, conversation } = await setupConversation({
      env: OAUTH,
      atlassianTokens: { getAtlassianToken },
    });

    await runner.prepare(conversation);

    expect(getAtlassianToken).toHaveBeenCalledOnce();
  });
});

describe('a busy conversation in oauth mode', () => {
  it('does not touch the sign-in while a turn is running', async () => {
    const getAtlassianToken = vi.fn(async () => ({
      accessToken: 'fake-signed-in-token',
      expiresAt: Date.parse('2030-01-01T00:00:00Z'),
    }));
    const { ask, conversation } = await setupConversation({
      env: OAUTH,
      atlassianTokens: { getAtlassianToken },
    });
    conversation.beginTurn({ question: 'Still running', detailLevel: 'default' });

    await expect(ask()).rejects.toThrow(ConversationBusyError);
    expect(getAtlassianToken).not.toHaveBeenCalled();
  });
});

describe('a conversation in basic or bearer mode', () => {
  it('has nothing to prepare', async () => {
    const { runner, conversation } = await setupConversation();

    await expect(runner.prepare(conversation)).resolves.toBeUndefined();
  });
});
