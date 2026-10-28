// @ts-check
import { ATLASSIAN_MCP_URL } from '../mcp/index.js';
import { parseTokenResponse } from './authorize.js';
import { oauthErrorOf, postForm } from './http.js';

/**
 * What the token endpoint said: the tokens, or the status and OAuth error code of a refusal.
 * Nothing else from a refusal is kept.
 * @typedef {{ ok: true, tokens: import('./authorize.js').TokenSet }
 *   | { ok: false, status: number, error: string | undefined }} TokenResult
 */

/**
 * Posts to the token endpoint and reads its answer.
 * @param {typeof fetch} fetchFunction - The fetch to use.
 * @param {string} tokenEndpoint - The endpoint.
 * @param {Record<string, string>} form - The grant.
 * @param {{ now: () => number }} clock - When the answer arrived decides when it expires.
 * @param {string} what - What it is for, in words.
 * @returns {Promise<TokenResult>} The tokens or the refusal.
 * @throws {AtlassianAuthError} When Atlassian cannot be reached, or answers 2xx with an unusable token.
 */
async function requestTokens(fetchFunction, tokenEndpoint, form, clock, what) {
  const result = await postForm(fetchFunction, tokenEndpoint, form, what);
  if (!result.ok) {
    return { ok: false, status: result.status, error: oauthErrorOf(result.body) };
  }
  return { ok: true, tokens: parseTokenResponse(result.body, clock.now()) };
}

/**
 * Exchanges an authorization code for the sign-in's tokens, proving with the PKCE verifier that
 * this app started the sign-in. The tokens are for the MCP server (`resource`).
 * @param {object} request - The exchange.
 * @param {typeof fetch} request.fetch - The fetch to use.
 * @param {string} request.tokenEndpoint - The token endpoint.
 * @param {import('./store.js').StoredClient} request.client - The app's registration.
 * @param {string} request.code - The code from the callback.
 * @param {string} request.verifier - The pending sign-in's verifier.
 * @param {{ now: () => number }} request.clock - Time source.
 * @returns {Promise<TokenResult>} The tokens or the refusal.
 * @throws {AtlassianAuthError} When Atlassian cannot be reached, or its answer is unusable.
 */
export function exchangeCode({ fetch, tokenEndpoint, client, code, verifier, clock }) {
  return requestTokens(
    fetch,
    tokenEndpoint,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
      resource: ATLASSIAN_MCP_URL,
    },
    clock,
    'finish signing in',
  );
}

/**
 * Renews a sign-in with its refresh token. Atlassian answers with a new refresh token too, and the
 * old one stops working, so the caller must save the answer before using it.
 * @param {object} request - The renewal.
 * @param {typeof fetch} request.fetch - The fetch to use.
 * @param {string} request.tokenEndpoint - The token endpoint.
 * @param {string} request.clientId - The app's client id.
 * @param {string} request.refreshToken - The current refresh token.
 * @param {{ now: () => number }} request.clock - Time source.
 * @returns {Promise<TokenResult>} The tokens or the refusal.
 * @throws {AtlassianAuthError} When Atlassian cannot be reached, or its answer is unusable.
 */
export function refreshTokens({ fetch, tokenEndpoint, clientId, refreshToken, clock }) {
  return requestTokens(
    fetch,
    tokenEndpoint,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: ATLASSIAN_MCP_URL,
    },
    clock,
    'renew the Atlassian sign-in',
  );
}
