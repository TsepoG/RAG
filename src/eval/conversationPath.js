// @ts-check

/**
 * Makes the function the eval uses to play a case as a conversation, through the same store and
 * runner the web server uses, so a conversation in the eval is the one a person has.
 * @param {object} deps - What it plays with.
 * @param {Pick<import('../conversation/index.js').ConversationStore, 'create'>} deps.store - Makes the conversations; making one ends the one before it.
 * @param {{ ask: (conversation: import('../conversation/index.js').Conversation, input: import('../conversation/index.js').TurnInput) => Promise<import('../answer/index.js').AskResult & { turn: number }> }} deps.runner - Asks a question in a conversation.
 * @returns {(role: import('../roles/index.js').Role) => Promise<import('./run.js').PlayedConversation>} Starts a conversation as a role.
 */
export function createConversationPath({ store, runner }) {
  return async (role) => {
    const conversation = await store.create({ role });
    return {
      async ask({ question, signal }) {
        const result = await runner.ask(conversation, { question, detailLevel: 'default', signal });
        // The keys this answer cites that an earlier turn fetched, so a case can require that an
        // earlier source is reused.
        const reusedKeys = result.sources
          .map(({ key }) => key)
          .filter(
            (key) => (conversation.registry.get(key)?.fetchedInTurn ?? result.turn) < result.turn,
          );
        return { ...result, reusedKeys };
      },
    };
  };
}
