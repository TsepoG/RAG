// @ts-check
import { z } from 'zod';
import { AtlassianAuthError } from '../errors/index.js';
import { ATLASSIAN_MCP_URL } from '../mcp/index.js';
import { CHALLENGE_METHOD } from './pkce.js';

/**
 * The scopes the app asks for: read-only Confluence through MCP, the person's own profile, and a
 * refresh token so the sign-in can be renewed. Never a `write:` scope.
 * @type {ReadonlyArray<string>}
 */
export const SCOPES = Object.freeze([
  'offline_access',
  'read:me',
  'read:account',
  'read:confluence:agent-interface',
  'search:confluence:agent-interface',
]);

/**
 * The scopes without which the assistant cannot read Confluence. A sign-in that lacks either is
 * not kept.
 * @type {ReadonlyArray<string>}
 */
export const REQUIRED_SCOPES = Object.freeze([
  'read:confluence:agent-interface',
  'search:confluence:agent-interface',
]);

const WRITE_SCOPE_PREFIX = 'write:';
const SCOPE_SEPARATOR = ' ';
const MS_PER_SECOND = 1000;

/** The OAuth error codes an authorization server may send back (RFC 6749 §4.1.2.1). */
const OAUTH_ERRORS = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
]);

/** A state this app made: 32 random bytes as base64url. */
const STATE_PATTERN = /^[\w-]{43}$/;

/** An authorization code: URL-safe characters, as base64, base64url or a signed token uses. */
const CODE_PATTERN = /^[\w.~+/=-]{1,4096}$/;

/**
 * What Atlassian's callback said, once checked.
 * @typedef {{ kind: 'code', code: string, state: string }
 *   | { kind: 'error', error: string }
 *   | { kind: 'invalid' }} CallbackResult
 *   `error` is one of the OAuth error codes, or `unknown`; nothing else from the query is kept.
 */

/**
 * A sign-in's tokens as the app keeps them.
 * @typedef {object} TokenSet
 * @property {string} accessToken - Sent to the MCP server as a Bearer token.
 * @property {string | undefined} refreshToken - Renews the sign-in; Atlassian replaces it each time.
 * @property {number} expiresAt - When the access token stops working, in ms.
 * @property {string[]} scopes - The scopes that were granted.
 */

/**
 * Builds the address the browser is sent to, to sign in.
 * @param {object} request - What to ask for.
 * @param {string} request.authorizationEndpoint - From the authorization server's metadata.
 * @param {string} request.clientId - The app's registered client id.
 * @param {string} request.redirectUri - Where Atlassian sends the browser back.
 * @param {string} request.state - The pending sign-in's state.
 * @param {string} request.challenge - The PKCE challenge.
 * @param {ReadonlyArray<string>} [request.scopes] - The scopes; only tests change them.
 * @returns {string} The authorize URL.
 * @throws {AtlassianAuthError} When a write scope would be asked for.
 */
export function buildAuthorizeUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  state,
  challenge,
  scopes = SCOPES,
}) {
  if (scopes.some((scope) => scope.startsWith(WRITE_SCOPE_PREFIX))) {
    throw new AtlassianAuthError('failed', 'The assistant never asks for a write scope');
  }
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(SCOPE_SEPARATOR));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', CHALLENGE_METHOD);
  url.searchParams.set('resource', ATLASSIAN_MCP_URL);
  return url.toString();
}

/**
 * Reads one query parameter. A parameter sent twice is treated as not usable.
 * @param {Readonly<Record<string, unknown>>} query - The parsed query.
 * @param {string} name - The parameter.
 * @returns {string | undefined | null} Its value, undefined when absent, or null when not a single string.
 */
function single(query, name) {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : null;
}

/**
 * Checks the query of Atlassian's callback. Only known shapes get through: a code and a state of
 * the expected form, or a known OAuth error code. The issuer is checked whenever one is sent, and
 * required when the server says it sends one (RFC 9207).
 * @param {Readonly<Record<string, unknown>>} query - The parsed query.
 * @param {{ issuer: string, issParameterSupported: boolean }} server - The authorization server.
 * @returns {CallbackResult} What the callback said.
 */
export function parseCallbackQuery(query, { issuer, issParameterSupported }) {
  const [code, state, error, iss] = ['code', 'state', 'error', 'iss'].map((name) =>
    single(query, name),
  );
  if ([code, state, error, iss].includes(null)) {
    return { kind: 'invalid' };
  }
  if ((iss !== undefined || issParameterSupported) && iss !== issuer) {
    return { kind: 'invalid' };
  }
  if (typeof error === 'string') {
    return { kind: 'error', error: OAUTH_ERRORS.has(error) ? error : 'unknown' };
  }
  if (
    typeof code === 'string' &&
    typeof state === 'string' &&
    CODE_PATTERN.test(code) &&
    STATE_PATTERN.test(state)
  ) {
    return { kind: 'code', code, state };
  }
  return { kind: 'invalid' };
}

/**
 * Says why a sign-in that Atlassian ended with an error did not complete.
 * @param {string} error - The OAuth error code, or `unknown`.
 * @returns {import('../errors/index.js').AtlassianAuthReason} The reason shown to the person.
 */
export function reasonForOAuthError(error) {
  if (error === 'access_denied') {
    return 'cancelled';
  }
  return error === 'invalid_scope' ? 'missing-permissions' : 'failed';
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((type) => type.toLowerCase() === 'bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

/**
 * Reads the token endpoint's answer. Nothing from the answer goes into the error.
 * @param {unknown} body - The parsed JSON.
 * @param {number} now - The time it arrived, in ms.
 * @returns {TokenSet} The tokens.
 * @throws {AtlassianAuthError} When the answer is not a usable Bearer token.
 */
export function parseTokenResponse(body, now) {
  const result = tokenResponseSchema.safeParse(body);
  if (!result.success) {
    throw new AtlassianAuthError('failed', 'Atlassian sent a token the assistant cannot use');
  }
  const { access_token, refresh_token, expires_in, scope } = result.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: now + expires_in * MS_PER_SECOND,
    // An answer without a scope was granted what was asked for (RFC 6749 §5.1).
    scopes: scope === undefined ? [...SCOPES] : scope.split(SCOPE_SEPARATOR).filter(Boolean),
  };
}

/**
 * Lists the required scopes a sign-in was not granted.
 * @param {ReadonlyArray<string>} granted - The granted scopes.
 * @returns {string[]} The missing ones; empty when the sign-in can be used.
 */
export function missingScopes(granted) {
  return REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}
