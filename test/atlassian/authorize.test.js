// @ts-check
import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  missingScopes,
  parseCallbackQuery,
  parseTokenResponse,
  reasonForOAuthError,
  REQUIRED_SCOPES,
  SCOPES,
} from '../../src/atlassian/authorize.js';
import { AtlassianAuthError } from '../../src/errors/index.js';

const ISSUER = 'https://auth.atlassian.com/tenant-id';
const SERVER = Object.freeze({ issuer: ISSUER, issParameterSupported: false });
const STATE = 'S'.repeat(43);
const CODE = 'fake-code.part_2~x';

/**
 * Runs something that should throw and returns what it threw.
 * @param {() => unknown} run - What to run.
 * @returns {Error} The error.
 */
function failureOf(run) {
  try {
    run();
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('expected a failure');
}

/** Builds a URL with the usual request, so each test changes only what it is about. */
const REQUEST = Object.freeze({
  authorizationEndpoint: 'https://auth.atlassian.com/authorize',
  clientId: 'client-123',
  redirectUri: 'http://127.0.0.1:3000/auth/atlassian/callback',
  state: STATE,
  challenge: 'challenge-abc',
});

describe('buildAuthorizeUrl', () => {
  it('asks for exactly the read scopes, the MCP resource, S256 and the redirect', () => {
    const url = new URL(buildAuthorizeUrl(REQUEST));

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.atlassian.com/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-123',
      redirect_uri: 'http://127.0.0.1:3000/auth/atlassian/callback',
      scope:
        'offline_access read:me read:account read:confluence:agent-interface search:confluence:agent-interface',
      state: STATE,
      code_challenge: 'challenge-abc',
      code_challenge_method: 'S256',
      resource: 'https://mcp.atlassian.com/v2/mcp',
    });
  });

  it('never asks for a write scope', () => {
    expect(SCOPES.some((scope) => scope.startsWith('write:'))).toBe(false);
    expect(() =>
      buildAuthorizeUrl({ ...REQUEST, scopes: [...SCOPES, 'write:confluence'] }),
    ).toThrow(AtlassianAuthError);
  });
});

describe('parseCallbackQuery', () => {
  it('accepts a code and a state of the expected shapes', () => {
    expect(parseCallbackQuery({ code: CODE, state: STATE }, SERVER)).toEqual({
      kind: 'code',
      code: CODE,
      state: STATE,
    });
  });

  it('ignores parameters it does not know', () => {
    expect(parseCallbackQuery({ code: CODE, state: STATE, extra: 'x' }, SERVER).kind).toBe('code');
  });

  it.each([
    ['no state', { code: CODE }],
    ['no code', { state: STATE }],
    ['a short state', { code: CODE, state: 'abc' }],
    ['a state with other characters', { code: CODE, state: `${'S'.repeat(42)}!` }],
    ['a code with a space', { code: 'a b', state: STATE }],
    ['an empty code', { code: '', state: STATE }],
    ['a code sent twice', { code: [CODE, CODE], state: STATE }],
    ['a state sent twice', { code: CODE, state: [STATE, STATE] }],
    ['nothing', {}],
  ])('refuses a callback with %s', (_label, query) => {
    expect(parseCallbackQuery(query, SERVER)).toEqual({ kind: 'invalid' });
  });

  it('keeps a known OAuth error code', () => {
    expect(parseCallbackQuery({ error: 'access_denied', state: STATE }, SERVER)).toEqual({
      kind: 'error',
      error: 'access_denied',
    });
  });

  it('turns an unknown error into "unknown", so nothing from the query is echoed', () => {
    expect(parseCallbackQuery({ error: '<script>alert(1)</script>' }, SERVER)).toEqual({
      kind: 'error',
      error: 'unknown',
    });
  });

  it('refuses an error sent twice', () => {
    expect(parseCallbackQuery({ error: ['a', 'b'] }, SERVER)).toEqual({ kind: 'invalid' });
  });

  describe('the issuer', () => {
    const supported = { issuer: ISSUER, issParameterSupported: true };

    it('is accepted when it matches', () => {
      expect(parseCallbackQuery({ code: CODE, state: STATE, iss: ISSUER }, supported).kind).toBe(
        'code',
      );
    });

    it('is required when the server says it sends one', () => {
      expect(parseCallbackQuery({ code: CODE, state: STATE }, supported)).toEqual({
        kind: 'invalid',
      });
    });

    it('is refused when it does not match, whether or not the server advertises it', () => {
      const query = { code: CODE, state: STATE, iss: 'https://evil.example' };

      expect(parseCallbackQuery(query, supported)).toEqual({ kind: 'invalid' });
      expect(parseCallbackQuery(query, SERVER)).toEqual({ kind: 'invalid' });
    });

    it('is checked on an error too', () => {
      expect(
        parseCallbackQuery({ error: 'access_denied', iss: 'https://evil.example' }, SERVER),
      ).toEqual({ kind: 'invalid' });
    });
  });
});

describe('reasonForOAuthError', () => {
  it.each([
    ['access_denied', 'cancelled'],
    ['invalid_scope', 'missing-permissions'],
    ['server_error', 'failed'],
    ['unknown', 'failed'],
  ])('turns %s into %s', (error, reason) => {
    expect(reasonForOAuthError(error)).toBe(reason);
  });
});

describe('parseTokenResponse', () => {
  const NOW = 1_000_000;
  const BODY = Object.freeze({
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    token_type: 'Bearer',
    expires_in: 28_800,
    scope: 'offline_access read:confluence:agent-interface search:confluence:agent-interface',
  });

  it('keeps the tokens, the expiry time and the granted scopes', () => {
    expect(parseTokenResponse(BODY, NOW)).toEqual({
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      expiresAt: NOW + 28_800_000,
      scopes: [
        'offline_access',
        'read:confluence:agent-interface',
        'search:confluence:agent-interface',
      ],
    });
  });

  it('accepts a lower-case token type and no refresh token', () => {
    const tokens = parseTokenResponse(
      { ...BODY, token_type: 'bearer', refresh_token: undefined },
      NOW,
    );

    expect(tokens.refreshToken).toBeUndefined();
  });

  it('takes an answer without a scope as granting what was asked for', () => {
    expect(parseTokenResponse({ ...BODY, scope: undefined }, NOW).scopes).toEqual([...SCOPES]);
  });

  it.each([
    ['no access token', { ...BODY, access_token: undefined }],
    ['another token type', { ...BODY, token_type: 'mac' }],
    ['no expiry', { ...BODY, expires_in: undefined }],
    ['a negative expiry', { ...BODY, expires_in: -1 }],
    ['a body that is not an object', 'oops'],
  ])('refuses an answer with %s, without repeating it', (_label, body) => {
    const error = failureOf(() => parseTokenResponse(body, NOW));

    expect(error).toBeInstanceOf(AtlassianAuthError);
    expect(error.message).not.toContain('fake-');
    expect(error.cause).toBeUndefined();
  });
});

describe('missingScopes', () => {
  it('is empty when both Confluence scopes were granted', () => {
    expect(missingScopes([...SCOPES])).toEqual([]);
  });

  it('lists each Confluence scope that was not granted', () => {
    expect(REQUIRED_SCOPES).toEqual([
      'read:confluence:agent-interface',
      'search:confluence:agent-interface',
    ]);
    expect(missingScopes(['offline_access', 'read:confluence:agent-interface'])).toEqual([
      'search:confluence:agent-interface',
    ]);
  });
});
