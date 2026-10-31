// @ts-check
import { maskSecrets } from '../logger/index.js';

// Pure readings of what gh and GitHub say, for gh-cli mode and `npm run github:check`. Nothing here
// runs a program or makes a request.

/** Where gh says its token comes from. */
/** @typedef {'keyring' | 'file' | 'environment' | 'unknown'} TokenSource */

/**
 * What `gh auth status` says about github.com. It never holds the token: the line that shows it
 * (masked by gh) is skipped.
 * @typedef {object} AuthStatus
 * @property {boolean} loggedIn - Whether gh is logged in to github.com.
 * @property {string | undefined} account - The account gh names.
 * @property {string[]} scopes - The token's scopes, as gh lists them.
 * @property {TokenSource} source - Where the token comes from.
 * @property {string | undefined} variable - The environment variable, when that is the source.
 * @property {string[]} attention - Lines about single sign-on or authorisation, masked.
 */

const LOGGED_IN = /Logged in to github\.com (?:account|as) (\S+) \(([^)]+)\)/;
const FAILED_LOGIN = /Failed to log in to github\.com/i;
const SCOPES = /Token scopes:(.*)$/i;
const TOKEN_LINE = /^[\s-]*Token:/i;
const ATTENTION = /\b(?:sso|saml)\b|authori[sz]/i;
const QUOTED = /'([^']+)'/g;
const ENVIRONMENT_SOURCES = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
]);
const LINE_CHARS = 200;

/**
 * Says where the token comes from, from what gh prints in brackets after the account.
 * @param {string} label - `keyring`, a config file path, or a variable name.
 * @returns {{ source: TokenSource, variable: string | undefined }} The source.
 */
function sourceOf(label) {
  if (ENVIRONMENT_SOURCES.has(label)) {
    return { source: 'environment', variable: label };
  }
  return { source: label === 'keyring' ? 'keyring' : 'file', variable: undefined };
}

/**
 * Reads `gh auth status --hostname github.com` (stdout and stderr together).
 * @param {string} text - What gh printed.
 * @returns {AuthStatus} What it says.
 */
export function parseAuthStatus(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '' && !TOKEN_LINE.test(line));
  const login = lines.map((line) => LOGGED_IN.exec(line)).find((match) => match !== null);
  const scopesLine = lines.map((line) => SCOPES.exec(line)).find((match) => match !== null);
  const failed = lines.some((line) => FAILED_LOGIN.test(line));
  const { source, variable } =
    login === undefined
      ? { source: /** @type {TokenSource} */ ('unknown'), variable: undefined }
      : sourceOf(login[2]);
  return {
    loggedIn: login !== undefined && !failed,
    account: login?.[1],
    scopes:
      scopesLine === undefined ? [] : [...scopesLine[1].trim().matchAll(QUOTED)].map((m) => m[1]),
    source,
    variable,
    attention: lines
      .filter((line) => ATTENTION.test(line))
      .map((line) => maskSecrets(line.trim(), [], LINE_CHARS)),
  };
}

/**
 * Why a GitHub request failed, in terms of what the person can do about it.
 * - `logged-out`: the token was refused (401); log in again.
 * - `sso`: the organisation needs the token authorised for single sign-on.
 * - `blocked`: the organisation restricts which apps may read its data, and the GitHub CLI is not
 *   one of them.
 * - `not-found`: no such repository, or no access to it.
 * - `other`: anything else.
 * @typedef {'logged-out' | 'sso' | 'blocked' | 'not-found' | 'other'} FailureKind
 */

const SSO_MESSAGE = /\b(?:sso|saml)\b|single sign-on/i;
const RESTRICTED_MESSAGE = /access restrictions|third-party application|oauth app/i;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;

/**
 * Classifies a failed GitHub request.
 * @param {{ status: number, ssoHeader?: string | null, message?: string }} failure - The status, the
 *   `X-GitHub-SSO` header if any, and GitHub's message if any.
 * @returns {FailureKind} The kind.
 */
export function classifyFailure({ status, ssoHeader, message = '' }) {
  if (status === UNAUTHORIZED) {
    return 'logged-out';
  }
  const restricted = RESTRICTED_MESSAGE.test(message);
  if (status === FORBIDDEN) {
    if ((ssoHeader ?? '') !== '' || SSO_MESSAGE.test(message)) {
      return 'sso';
    }
    return restricted ? 'blocked' : 'other';
  }
  if (status === NOT_FOUND) {
    return restricted ? 'blocked' : 'not-found';
  }
  return 'other';
}
