// @ts-check
import { AtlassianAuthError } from '../errors/index.js';
import {
  buildAuthorizeUrl,
  missingScopes,
  parseCallbackQuery,
  reasonForOAuthError,
} from './authorize.js';
import { ensureClient } from './client.js';
import { checkSite } from './identity.js';
import { exchangeCode } from './tokenEndpoint.js';

/** Token-endpoint refusals that need their own handling. */
const USED_CODE = 'invalid_grant';
const UNKNOWN_CLIENT = 'invalid_client';

/**
 * How a finished sign-in went: saved, or why not.
 * @typedef {{ ok: true } | { ok: false, reason: import('../errors/index.js').AtlassianAuthReason }} SignInOutcome
 */

/**
 * The two halves of signing in from the web app.
 * @typedef {object} SignInFlow
 * @property {() => Promise<{ authorizeUrl: string, nonce: string }>} start - Starts a sign-in:
 *   the address to send the browser to, and the nonce to set as its cookie.
 * @property {(callback: { query: Readonly<Record<string, unknown>>, nonce: string | undefined }) => Promise<SignInOutcome>} finish -
 *   Finishes it from Atlassian's callback and the browser's cookie.
 */

/**
 * What the flow depends on.
 * @typedef {object} SignInFlowDeps
 * @property {{ cloudId: string, siteUrl: string, redirectUri: string, mcpTimeoutMs: number }} settings -
 *   The configured site, where the sign-in comes back to, and the MCP time limit.
 * @property {import('./discovery.js').Discovery} discovery - Finds the authorization server.
 * @property {import('./store.js').SignInStore} store - Where the registration and the sign-in are kept.
 * @property {ReturnType<typeof import('./pending.js').createPendingSignIns>} pending - The sign-in waiting for its callback.
 * @property {typeof fetch} fetch - The fetch to use.
 * @property {{ now: () => number }} clock - Time source.
 * @property {Parameters<typeof checkSite>[0]['connect']} connect - Opens an MCP connection.
 * @property {Pick<import('../logger/index.js').Logger, 'info' | 'warn' | 'error'>} logger - Where outcomes are logged.
 */

/**
 * Creates the sign-in flow. Starting it registers the app if needed, keeps a pending sign-in and
 * builds the authorize URL. Finishing it checks the callback (its shape, the issuer, the state and
 * the browser's cookie), exchanges the code, checks the granted scopes and the site, and only then
 * saves the sign-in. Any failure leaves nothing saved and gives a reason the error page can explain.
 * Only reasons are logged: never a code, a state, a nonce or a token.
 * @param {SignInFlowDeps} deps - Settings and dependencies.
 * @returns {SignInFlow} The flow.
 */
export function createSignInFlow(deps) {
  const { settings, discovery, store, pending, fetch, clock, connect, logger } = deps;

  /**
   * Exchanges the code and checks what came back, saving the sign-in when it is usable.
   * @param {import('./discovery.js').AuthorizationServer} server - The authorization server.
   * @param {string} code - The authorization code.
   * @param {string} verifier - The pending sign-in's verifier.
   * @returns {Promise<SignInOutcome>} The outcome.
   */
  async function complete(server, code, verifier) {
    const client = await store.readClient();
    // The code was issued for the registration and redirect the sign-in started with.
    if (client?.redirectUri !== settings.redirectUri) {
      return { ok: false, reason: 'failed' };
    }
    const result = await exchangeCode({
      fetch,
      tokenEndpoint: server.tokenEndpoint,
      client,
      code,
      verifier,
      clock,
    });
    if (!result.ok) {
      logger.warn({ status: result.status, error: result.error }, 'Atlassian refused the sign-in');
      if (result.error === UNKNOWN_CLIENT) {
        // Atlassian no longer knows this registration; the next sign-in registers again.
        await store.deleteClient();
      }
      return { ok: false, reason: result.error === USED_CODE ? 'expired' : 'failed' };
    }
    const { tokens } = result;
    if (tokens.refreshToken === undefined || missingScopes(tokens.scopes).length > 0) {
      return { ok: false, reason: 'missing-permissions' };
    }
    const site = await checkSite({
      accessToken: tokens.accessToken,
      cloudId: settings.cloudId,
      siteUrl: settings.siteUrl,
      timeoutMs: settings.mcpTimeoutMs,
      connect,
    });
    if (!site.ok) {
      return site;
    }
    await store.writeSignIn({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      cloudId: settings.cloudId,
      siteHost: site.siteHost,
    });
    return { ok: true };
  }

  /**
   * Finishes a sign-in, turning every failure into a reason.
   * @param {{ query: Readonly<Record<string, unknown>>, nonce: string | undefined }} callback - The callback.
   * @returns {Promise<SignInOutcome>} The outcome.
   */
  async function finish({ query, nonce }) {
    const server = await discovery.authorizationServer();
    const parsed = parseCallbackQuery(query, server);
    if (parsed.kind === 'invalid') {
      return { ok: false, reason: 'failed' };
    }
    if (parsed.kind === 'error') {
      if (parsed.error === 'unauthorized_client') {
        await store.deleteClient();
      }
      return { ok: false, reason: reasonForOAuthError(parsed.error) };
    }
    const taken = pending.take({ state: parsed.state, nonce });
    if (!taken.ok) {
      return taken;
    }
    return complete(server, parsed.code, taken.verifier);
  }

  return {
    async start() {
      const server = await discovery.authorizationServer();
      const client = await ensureClient({
        store,
        server,
        redirectUri: settings.redirectUri,
        fetch,
        logger,
      });
      const { state, nonce, challenge } = pending.start();
      const authorizeUrl = buildAuthorizeUrl({
        authorizationEndpoint: server.authorizationEndpoint,
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        state,
        challenge,
      });
      return { authorizeUrl, nonce };
    },
    async finish(callback) {
      /** @type {SignInOutcome} */
      let outcome;
      try {
        outcome = await finish(callback);
      } catch (error) {
        if (error instanceof AtlassianAuthError) {
          // These messages name a status or a rule, never a value.
          logger.warn({ detail: error.message }, 'signing in failed');
        } else {
          logger.error({ err: error }, 'signing in failed unexpectedly');
        }
        outcome = { ok: false, reason: 'failed' };
      }
      if (outcome.ok) {
        logger.info({}, 'signed in to Atlassian');
      } else {
        logger.warn({ reason: outcome.reason }, 'signing in did not complete');
      }
      return outcome;
    },
  };
}
