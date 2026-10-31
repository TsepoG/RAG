// @ts-check
import { SESSION_TOKEN_MARGIN_MS, turnTokenMargin } from '../atlassian/index.js';
import { ALLOWLIST, buildMcpServers, SERVER_KEYS } from '../mcp/index.js';

/**
 * The Atlassian token a conversation's session was made with, or last given.
 * @typedef {{ accessToken: string, expiresAt: number }} SessionToken
 */

/**
 * The tokens a conversation's session holds: Atlassian's in oauth mode, GitHub's in gh-cli mode.
 * @typedef {{ atlassian?: SessionToken, github?: string }} HeldTokens
 */

/**
 * The part of a live session that can be handed a new token.
 * @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'rpc'>} RestartableSession
 */

/**
 * Keeps each conversation's session supplied with the tokens that are not a fixed setting: the
 * signed-in person's Atlassian token in oauth mode, and the GitHub CLI's token in gh-cli mode.
 * @typedef {object} SessionTokens
 * @property {(conversation: import('./conversation.js').Conversation) => Promise<void>} prepare -
 *   Makes sure the conversation has tokens that last the next turn. Throws
 *   AtlassianSignInRequiredError when there is no Atlassian sign-in or it cannot be renewed, and
 *   GithubSignInRequiredError when the GitHub CLI has no token.
 * @property {(conversation: import('./conversation.js').Conversation) => string | undefined} tokenFor -
 *   The Atlassian token to make the conversation's session with.
 * @property {(conversation: import('./conversation.js').Conversation) => { atlassianToken?: string, githubToken?: string }} tokensFor -
 *   Every token to make the conversation's session with.
 */

/**
 * Creates the keeper of the conversations' tokens.
 * - Atlassian: before a conversation has a session, its token must have three hours left, so it
 *   lasts the whole conversation. Once it has one, the provider is asked before every turn for a
 *   token that lasts the turn. The sign-in file is the one record of the sign-in, so this sees a
 *   renewal made by another process, a sign-out, or a refresh token that no longer works.
 * - GitHub: the CLI is asked before every turn, not the five-minute cache, because `gh auth logout`
 *   does not revoke the token: only asking the CLI shows that the person logged out or switched.
 * - When a provider hands back a different token, it is given to the live session by restarting
 *   only that server. The entries are built exactly as the originals were, with the same tools and
 *   time limit; only the Authorization header differs. Both servers can be swapped in one turn.
 * @param {object} deps - What it needs.
 * @param {Pick<import('../atlassian/index.js').TokenProvider, 'getAtlassianToken'>} [deps.atlassianTokens] -
 *   The Atlassian provider, in oauth mode.
 * @param {Pick<import('../github/index.js').CliTokenProvider, 'getGithubToken'>} [deps.githubTokens] -
 *   The GitHub CLI provider, in gh-cli mode.
 * @param {import('../config/index.js').AppConfig} deps.config - Validated config.
 * @param {Pick<import('../logger/index.js').Logger, 'info'>} deps.logger - Where a swap is logged.
 * @returns {SessionTokens} The keeper.
 */
export function createSessionTokens({ atlassianTokens, githubTokens, config, logger }) {
  /** @type {WeakMap<import('./conversation.js').Conversation, HeldTokens>} */
  const held = new WeakMap();
  const turnMarginMs = turnTokenMargin(config.copilot.askTimeoutMs);

  /**
   * Asks each provider for a token good enough for what comes next. Atlassian first, so its
   * refusal is the one reported when both fail; the page asks for both states anyway.
   * @param {boolean} hasSession - Whether the session exists already.
   * @returns {Promise<HeldTokens>} The tokens.
   */
  async function fetchTokens(hasSession) {
    const minValidityMs = hasSession ? turnMarginMs : SESSION_TOKEN_MARGIN_MS;
    const atlassian = await atlassianTokens?.getAtlassianToken({ minValidityMs });
    const github = await githubTokens?.getGithubToken({ fresh: true });
    return { atlassian, github };
  }

  /**
   * Gives a live session the tokens that changed, restarting only those servers.
   * @param {RestartableSession} session - The session.
   * @param {HeldTokens} before - What the session holds.
   * @param {HeldTokens} fresh - What the providers gave.
   * @returns {Promise<HeldTokens>} What the session holds now.
   */
  async function swap(session, before, fresh) {
    const atlassianChanged =
      fresh.atlassian !== undefined &&
      fresh.atlassian.accessToken !== before.atlassian?.accessToken;
    const githubChanged = fresh.github !== undefined && fresh.github !== before.github;
    if (!atlassianChanged && !githubChanged) {
      return before;
    }
    const servers = buildMcpServers(config, ALLOWLIST, {
      atlassianToken: fresh.atlassian?.accessToken,
      githubToken: fresh.github,
    });
    if (atlassianChanged) {
      await session.rpc.mcp.restartServer({
        serverName: SERVER_KEYS.atlassian,
        config: servers[SERVER_KEYS.atlassian],
      });
      logger.info(
        { expiresAt: fresh.atlassian?.expiresAt },
        'gave the conversation a renewed Atlassian sign-in',
      );
    }
    if (githubChanged) {
      await session.rpc.mcp.restartServer({
        serverName: SERVER_KEYS.github,
        config: servers[SERVER_KEYS.github],
      });
      logger.info({}, 'gave the conversation a renewed GitHub CLI login');
    }
    return fresh;
  }

  return {
    async prepare(conversation) {
      const session = /** @type {RestartableSession | undefined} */ (conversation.session());
      const fresh = await fetchTokens(session !== undefined);
      if (session === undefined) {
        held.set(conversation, fresh);
        return;
      }
      held.set(conversation, await swap(session, held.get(conversation) ?? {}, fresh));
    },
    tokenFor: (conversation) => held.get(conversation)?.atlassian?.accessToken,
    tokensFor(conversation) {
      const tokens = held.get(conversation);
      return { atlassianToken: tokens?.atlassian?.accessToken, githubToken: tokens?.github };
    },
  };
}
