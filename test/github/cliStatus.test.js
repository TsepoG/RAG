// @ts-check
import { describe, expect, it } from 'vitest';
import { classifyFailure, parseAuthStatus } from '../../src/github/index.js';

const FAKE_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';

/**
 * What `gh auth status --hostname github.com` prints for a logged-in account.
 * @param {string} source - What gh shows in brackets.
 * @param {string[]} [extra] - More lines.
 * @returns {string} The output.
 */
function loggedIn(source, extra = []) {
  return [
    'github.com',
    `  ✓ Logged in to github.com account TsepoG (${source})`,
    '  - Active account: true',
    '  - Git operations protocol: https',
    `  - Token: ${FAKE_TOKEN}`,
    "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
    ...extra,
  ].join('\n');
}

describe('parseAuthStatus', () => {
  it('reads a login kept in the keyring, with its account and scopes', () => {
    expect(parseAuthStatus(loggedIn('keyring'))).toEqual({
      loggedIn: true,
      account: 'TsepoG',
      scopes: ['gist', 'read:org', 'repo', 'workflow'],
      source: 'keyring',
      variable: undefined,
      attention: [],
    });
  });

  it("reads a login kept in gh's config file, without giving the path", () => {
    const status = parseAuthStatus(
      loggedIn('C:\\Users\\dev\\AppData\\Roaming\\GitHub CLI\\hosts.yml'),
    );

    expect(status.source).toBe('file');
    expect(JSON.stringify(status)).not.toContain('hosts.yml');
  });

  it.each(['GH_TOKEN', 'GITHUB_TOKEN'])('says when the token comes from %s', (variable) => {
    expect(parseAuthStatus(loggedIn(variable))).toMatchObject({
      source: 'environment',
      variable,
    });
  });

  it('reads the older "as" wording too', () => {
    const status = parseAuthStatus('github.com\n  ✓ Logged in to github.com as TsepoG (keyring)\n');

    expect(status).toMatchObject({ loggedIn: true, account: 'TsepoG', scopes: [] });
  });

  it('says when gh is not logged in', () => {
    expect(
      parseAuthStatus('You are not logged into any GitHub hosts. To log in, run: gh auth login\n'),
    ).toEqual({
      loggedIn: false,
      account: undefined,
      scopes: [],
      source: 'unknown',
      variable: undefined,
      attention: [],
    });
  });

  it('says when the stored login no longer works', () => {
    const status = parseAuthStatus(
      [
        'github.com',
        '  X Failed to log in to github.com account TsepoG (keyring)',
        '  - The token in keyring is invalid.',
        '  ✓ Logged in to github.com account TsepoG (keyring)',
      ].join('\n'),
    );

    expect(status.loggedIn).toBe(false);
  });

  it('keeps the single sign-on and authorisation lines, with any token masked', () => {
    const status = parseAuthStatus(
      loggedIn('keyring', [
        `  ! Organization acme requires SAML SSO authorization for token ${FAKE_TOKEN}`,
        '  ! Authorize the GitHub CLI for acme at https://github.com/orgs/acme/sso',
      ]),
    );

    expect(status.attention).toHaveLength(2);
    expect(status.attention[0]).toContain('SAML SSO');
    expect(JSON.stringify(status)).not.toContain(FAKE_TOKEN);
  });

  it('never keeps the token line, even unmasked', () => {
    expect(JSON.stringify(parseAuthStatus(loggedIn('keyring')))).not.toContain(FAKE_TOKEN);
  });
});

describe('classifyFailure', () => {
  it.each([
    [{ status: 401 }, 'logged-out'],
    [{ status: 403, ssoHeader: 'required; url=https://github.com/orgs/acme/sso' }, 'sso'],
    [
      {
        status: 403,
        message:
          'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
      },
      'sso',
    ],
    [
      {
        status: 403,
        message:
          'Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions',
      },
      'blocked',
    ],
    [{ status: 404, message: 'third-party application access restrictions apply' }, 'blocked'],
    [{ status: 404, message: 'Not Found' }, 'not-found'],
    [{ status: 404 }, 'not-found'],
    [{ status: 403, ssoHeader: null, message: 'API rate limit exceeded' }, 'other'],
    [{ status: 500 }, 'other'],
  ])('classifies %j as %s', (failure, kind) => {
    expect(classifyFailure(failure)).toBe(kind);
  });
});
