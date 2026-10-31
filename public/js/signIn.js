// @ts-check
import { ApiError } from './api.js';

/** The code the server gives when a question needs an Atlassian sign-in that is not there. */
export const SIGN_IN_REQUIRED = 'atlassian_signin_required';

/** The code the server gives when a question needs the GitHub CLI's token and there is none. */
export const GITHUB_SIGN_IN_REQUIRED = 'github_signin_required';

/** The kind of a streamed error that means the sign-in ran out in the middle of a question. */
const SIGN_IN_FAILURE = 'signin';

/** The kind of a streamed error that means the GitHub CLI's token stopped working. */
const GITHUB_SIGN_IN_FAILURE = 'github-signin';

/** The GitHub auth mode in which the GitHub CLI's login is used. */
const GH_CLI_MODE = 'gh-cli';

/** Why the GitHub CLI has no token, when nothing more precise is known. */
const DEFAULT_GITHUB_REASON = 'logged-out';

/** What screen readers hear for each reason the GitHub CLI has no token. */
export const GITHUB_MESSAGES = Object.freeze({
  'logged-out': "GitHub CLI isn't logged in.",
  sso: 'GitHub needs your organisation authorised.',
  'cli-missing': 'GitHub CLI not found.',
});

/** What screen readers hear once the GitHub CLI has a token again. */
export const GITHUB_READY_MESSAGE = 'GitHub CLI is logged in.';

/** Said when the GitHub CLI could not be checked again. */
export const GITHUB_CHECK_FAILED = 'The GitHub CLI could not be checked. Please try again.';

/** What screen readers hear when the sign-in has expired. */
export const EXPIRED_MESSAGE = 'Your Atlassian sign-in has expired.';

/** What the toast says after signing out. */
export const SIGNED_OUT_MESSAGE = 'Signed out';

/** Said when signing out did not work. */
export const SIGN_OUT_FAILED = 'Signing out did not work. Please try again.';

/** Said when the sign-in status could not be read. */
export const STATUS_FAILED = 'Whether you are signed in to Atlassian could not be checked.';

/**
 * What the page shows about the sign-in.
 * @typedef {object} SignInView
 * @property {boolean} needed - Whether the person must sign in before asking anything more.
 * @property {{ siteHost: string | undefined } | undefined} account - Who is signed in, for the
 *   signed-in panel; only in oauth mode, while the sign-in works.
 * @property {boolean} [atlassianNeeded] - In gh-cli mode, whether the Atlassian part of `needed` is
 *   set; `needed` then covers GitHub too.
 * @property {GithubView} [github] - In gh-cli mode only: the GitHub CLI's state.
 */

/**
 * What the page shows about the GitHub CLI, in gh-cli mode.
 * @typedef {object} GithubView
 * @property {boolean} needed - Whether the person must log the GitHub CLI in before asking more.
 * @property {keyof typeof GITHUB_MESSAGES} reason - What they have to do, while `needed`.
 * @property {string | undefined} login - The account, while there is a token and gh can say.
 */

/**
 * Whether an error is the server saying a question needs a sign-in.
 * @param {unknown} error - What was thrown.
 * @returns {boolean} True for a 401 `atlassian_signin_required`.
 */
export function isSignInError(error) {
  return error instanceof ApiError && error.code === SIGN_IN_REQUIRED;
}

/**
 * Whether a streamed event says the sign-in ran out while the question was being answered.
 * @param {{ event: string, data: unknown }} event - The event.
 * @returns {boolean} True for an `error` event of kind `signin`.
 */
export function isSignInEvent({ event, data }) {
  return (
    event === 'error' &&
    typeof data === 'object' &&
    data !== null &&
    /** @type {{ kind?: unknown }} */ (data).kind === SIGN_IN_FAILURE
  );
}

/**
 * Whether an error is the server saying a question needs the GitHub CLI's token.
 * @param {unknown} error - What was thrown.
 * @returns {boolean} True for a 401 `github_signin_required`.
 */
export function isGithubSignInError(error) {
  return error instanceof ApiError && error.code === GITHUB_SIGN_IN_REQUIRED;
}

/**
 * Whether a streamed event says the GitHub CLI's token stopped working during the question.
 * @param {{ event: string, data: unknown }} event - The event.
 * @returns {boolean} True for an `error` event of kind `github-signin`.
 */
export function isGithubSignInEvent({ event, data }) {
  return (
    event === 'error' &&
    typeof data === 'object' &&
    data !== null &&
    /** @type {{ kind?: unknown }} */ (data).kind === GITHUB_SIGN_IN_FAILURE
  );
}

/**
 * Reads a reason the server gave, keeping only the ones the page has words for.
 * @param {unknown} reason - The reason.
 * @returns {keyof typeof GITHUB_MESSAGES} The reason, or `logged-out` when it is not known.
 */
export function githubReasonOf(reason) {
  return typeof reason === 'string' && Object.hasOwn(GITHUB_MESSAGES, reason)
    ? /** @type {keyof typeof GITHUB_MESSAGES} */ (reason)
    : DEFAULT_GITHUB_REASON;
}

/**
 * Keeps what the page knows about the Atlassian sign-in. Until the server says otherwise, nobody
 * needs to sign in: basic and bearer modes, and a page whose server has no sign-in, work as before.
 * The GitHub CLI's state is kept beside it, in gh-cli mode only; in token mode nothing about GitHub
 * is shown.
 * @returns {{
 *   load: (status: import('./api.js').AuthStatus) => void,
 *   loadGithub: (github: import('./api.js').GithubStatus | undefined) => void,
 *   markNeeded: () => void,
 *   markGithubNeeded: (reason?: string) => void,
 *   signedOut: () => void,
 *   view: () => SignInView,
 * }} The sign-in state.
 */
export function createSignInState() {
  /** @type {import('./api.js').AuthStatus | undefined} */
  let status;
  let needed = false;
  const isOauth = () => status?.mode === 'oauth';
  /** @type {GithubView | undefined} */
  let github;

  /**
   * Takes in what the server says about GitHub; token mode leaves nothing to show.
   * @param {import('./api.js').GithubStatus | undefined} next - GitHub's status.
   */
  function loadGithub(next) {
    github =
      next?.mode === GH_CLI_MODE
        ? { needed: !next.signedIn, reason: githubReasonOf(next.reason), login: next.login }
        : undefined;
  }

  return {
    load(next) {
      status = next;
      needed = isOauth() && !next.signedIn;
      loadGithub(next.github);
    },
    loadGithub,
    markGithubNeeded(reason) {
      github = { needed: true, reason: githubReasonOf(reason), login: undefined };
    },
    markNeeded() {
      needed = true;
    },
    signedOut() {
      if (status !== undefined) {
        status = { ...status, signedIn: false };
      }
      needed = true;
    },
    view() {
      const account =
        isOauth() && status?.signedIn === true && !needed
          ? { siteHost: status.siteHost }
          : undefined;
      if (github === undefined) {
        return { needed, account };
      }
      return { needed: needed || github.needed, account, atlassianNeeded: needed, github };
    },
  };
}
