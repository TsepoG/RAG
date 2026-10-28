// @ts-check
import { SESSION_TOKEN_MARGIN_MS, turnTokenMargin } from '../atlassian/index.js';
import { ALLOWLIST, buildMcpServers, SERVER_KEYS } from '../mcp/index.js';

/**
 * The Atlassian token a conversation's session was made with, or last given.
 * @typedef {{ accessToken: string, expiresAt: number }} SessionToken
 */

/**
 * The part of a live session that can be handed a new token.
 * @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'rpc'>} RestartableSession
 */

/**
 * Keeps each conversation's session supplied with the signed-in person's Atlassian token, in oauth
 * mode.
 * @typedef {object} SessionTokens
 * @property {(conversation: import('./conversation.js').Conversation) => Promise<void>} prepare -
 *   Makes sure the conversation has a token that lasts the next turn. Throws
 *   AtlassianSignInRequiredError when there is no sign-in or it cannot be renewed.
 * @property {(conversation: import('./conversation.js').Conversation) => string | undefined} tokenFor -
 *   The token to make the conversation's session with.
 */

/**
 * Creates the keeper of the conversations' tokens.
 * - Before a conversation has a session, its token must have three hours left, so it lasts the
 *   whole conversation.
 * - Once it has one, a token that would run out during the next turn is renewed and handed to the
 *   live session by restarting only its Atlassian MCP server. The new entry is built exactly as the
 *   original was, with the same tools and time limit; only the Authorization header differs.
 * @param {object} deps - What it needs.
 * @param {Pick<import('../atlassian/index.js').TokenProvider, 'getAtlassianToken'>} deps.atlassianTokens - The provider.
 * @param {import('../config/index.js').AppConfig} deps.config - Validated config.
 * @param {{ now: () => number }} deps.clock - Time source.
 * @param {Pick<import('../logger/index.js').Logger, 'info'>} deps.logger - Where a swap is logged.
 * @returns {SessionTokens} The keeper.
 */
export function createSessionTokens({ atlassianTokens, config, clock, logger }) {
  /** @type {WeakMap<import('./conversation.js').Conversation, SessionToken>} */
  const tokens = new WeakMap();
  const turnMarginMs = turnTokenMargin(config.copilot.askTimeoutMs);

  return {
    async prepare(conversation) {
      const session = /** @type {RestartableSession | undefined} */ (conversation.session());
      if (session === undefined) {
        tokens.set(
          conversation,
          await atlassianTokens.getAtlassianToken({ minValidityMs: SESSION_TOKEN_MARGIN_MS }),
        );
        return;
      }
      const current = tokens.get(conversation);
      if (current !== undefined && current.expiresAt - clock.now() > turnMarginMs) {
        return;
      }
      const fresh = await atlassianTokens.getAtlassianToken({ minValidityMs: turnMarginMs });
      const servers = buildMcpServers(config, ALLOWLIST, { atlassianToken: fresh.accessToken });
      await session.rpc.mcp.restartServer({
        serverName: SERVER_KEYS.atlassian,
        config: servers[SERVER_KEYS.atlassian],
      });
      tokens.set(conversation, fresh);
      logger.info(
        { expiresAt: fresh.expiresAt },
        'gave the conversation a renewed Atlassian sign-in',
      );
    },
    tokenFor: (conversation) => tokens.get(conversation)?.accessToken,
  };
}
