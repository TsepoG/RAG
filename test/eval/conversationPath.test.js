// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createConversationRegistry } from '../../src/citations/index.js';
import { createConversation } from '../../src/conversation/index.js';
import { createConversationPath } from '../../src/eval/conversationPath.js';
import { confluenceSource } from '../helpers/sources.js';
import { makeRole } from '../helpers/role.js';

const ROLE = makeRole({ id: 'developer' });

/**
 * A conversation whose registry has two pages, fetched in turns 1 and 2.
 * @returns {import('../../src/conversation/index.js').Conversation} The conversation.
 */
function conversationWithPages() {
  const clock = { now: () => 0 };
  const conversation = createConversation({
    id: 'c',
    role: ROLE,
    registry: createConversationRegistry({ clock }),
    clock,
    limits: { maxTurns: 5, maxSourceChars: 1000 },
  });
  conversation.registry.setTurn(1);
  conversation.registry.register(confluenceSource({ id: '1' }));
  conversation.registry.setTurn(2);
  conversation.registry.register(confluenceSource({ id: '2' }));
  return conversation;
}

describe('createConversationPath', () => {
  it('starts a conversation as the role, and asks each question in it at the usual level', async () => {
    const conversation = conversationWithPages();
    const create = vi.fn(async () => conversation);
    const ask = vi.fn(async () => ({ turn: 2, sources: [] }));
    const start = createConversationPath({
      store: { create },
      runner: { ask: /** @type {any} */ (ask) },
    });
    const controller = new AbortController();

    const played = await start(ROLE);
    await played.ask({ question: 'How?', signal: controller.signal });

    expect(create).toHaveBeenCalledExactlyOnceWith({ role: ROLE });
    expect(ask).toHaveBeenCalledWith(conversation, {
      question: 'How?',
      detailLevel: 'default',
      signal: controller.signal,
    });
  });

  it('says which of the cited keys an earlier turn fetched', async () => {
    const conversation = conversationWithPages();
    const ask = vi.fn(async () => ({ turn: 2, sources: [{ key: 'C1' }, { key: 'C2' }] }));
    const start = createConversationPath({
      store: { create: async () => conversation },
      runner: { ask: /** @type {any} */ (ask) },
    });

    const result = await (await start(ROLE)).ask({ question: 'How?' });

    expect(result.reusedKeys).toEqual(['C1']);
    expect(result.sources).toEqual([{ key: 'C1' }, { key: 'C2' }]);
  });

  it('counts a key the conversation does not know as fetched in this turn', async () => {
    const conversation = conversationWithPages();
    const start = createConversationPath({
      store: { create: async () => conversation },
      runner: { ask: /** @type {any} */ (async () => ({ turn: 2, sources: [{ key: 'C9' }] })) },
    });

    expect((await (await start(ROLE)).ask({ question: 'How?' })).reusedKeys).toEqual([]);
  });
});
