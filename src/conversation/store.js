// @ts-check
import { createConversationRegistry } from '../citations/index.js';
import { ConversationEndedError } from '../errors/index.js';
import { createConversation } from './conversation.js';

const MS_PER_MINUTE = 60_000;

/**
 * Closes a conversation's open session. It aborts a running turn first, then disconnects, and it
 * never throws: whoever supplies it logs trouble and carries on.
 * @callback CloseSession
 * @param {unknown} session - The session.
 * @param {{ running: boolean }} state - Whether a turn is running in it.
 * @returns {Promise<void>} Resolves when it is closed or given up on.
 */

/**
 * The store of conversations. There is one active conversation, because this is a local app for
 * one person; starting another closes the first.
 * @typedef {object} ConversationStore
 * @property {(input: { role: import('../roles/index.js').Role }) => Promise<import('./conversation.js').Conversation>} create - Starts a conversation, closing the active one.
 * @property {() => import('./conversation.js').Conversation | undefined} active - The active conversation, if there is one.
 * @property {(id: string) => import('./conversation.js').Conversation | undefined} get - The conversation, unless it is unknown or has expired.
 * @property {(id: string) => import('./conversation.js').Conversation} require - Like `get`, but throws when there is none.
 * @property {(conversation: import('./conversation.js').Conversation, reason: string) => Promise<void>} end - Closes it to new questions and frees its session; its transcript stays.
 * @property {(id: string) => Promise<boolean>} remove - Closes and forgets a conversation; false when there was none.
 * @property {() => Promise<void>} close - Ends and closes the active conversation, for shutdown.
 * @property {() => Promise<string[]>} sweep - Forgets the active conversation if it has been idle too long; gives its id.
 */

/**
 * Creates the store.
 * @param {object} deps - What it needs.
 * @param {{ now: () => number }} deps.clock - The time source.
 * @param {import('./conversation.js').ConversationLimits & { idleMinutes: number }} deps.limits - The limits.
 * @param {CloseSession} deps.closeSession - Closes a session.
 * @param {() => string} deps.newId - Makes a conversation id.
 * @returns {ConversationStore} An empty store.
 */
export function createConversationStore({ clock, limits, closeSession, newId }) {
  /** @type {import('./conversation.js').Conversation | undefined} */
  let active;

  /**
   * Frees a conversation's session, once.
   * @param {import('./conversation.js').Conversation} conversation - The conversation.
   * @returns {Promise<void>} Resolves when the session is closed.
   */
  async function release(conversation) {
    const running = conversation.isBusy();
    const session = conversation.takeSession();
    if (session !== undefined) {
      await closeSession(session, { running });
    }
  }

  /**
   * Whether the conversation has been left alone too long. One with a turn running is not idle.
   * @param {import('./conversation.js').Conversation} conversation - The conversation.
   * @returns {boolean} True when it should be forgotten.
   */
  function isIdle(conversation) {
    const idleMs = limits.idleMinutes * MS_PER_MINUTE;
    return !conversation.isBusy() && clock.now() - conversation.lastActivityAt() >= idleMs;
  }

  /** @type {ConversationStore} */
  const store = {
    async create({ role }) {
      const previous = active;
      const conversation = createConversation({
        id: newId(),
        role,
        registry: createConversationRegistry({ clock }),
        clock,
        limits,
      });
      active = conversation;
      if (previous !== undefined) {
        previous.end('replaced');
        await release(previous);
      }
      return conversation;
    },
    active: () => active,
    get(id) {
      return active?.id === id && !isIdle(active) ? active : undefined;
    },
    require(id) {
      const conversation = store.get(id);
      if (conversation === undefined) {
        throw new ConversationEndedError();
      }
      return conversation;
    },
    async end(conversation, reason) {
      conversation.end(reason);
      await release(conversation);
    },
    async remove(id) {
      const conversation = store.get(id);
      if (conversation === undefined) {
        return false;
      }
      active = undefined;
      conversation.end('deleted');
      await release(conversation);
      return true;
    },
    async close() {
      const open = active;
      active = undefined;
      if (open !== undefined) {
        open.end('shutdown');
        await release(open);
      }
    },
    async sweep() {
      const idle = active;
      if (idle === undefined || !isIdle(idle)) {
        return [];
      }
      active = undefined;
      idle.end('idle');
      await release(idle);
      return [idle.id];
    },
  };
  return store;
}
