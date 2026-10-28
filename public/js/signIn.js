// @ts-check
import { ApiError } from './api.js';

/** The code the server gives when a question needs an Atlassian sign-in that is not there. */
export const SIGN_IN_REQUIRED = 'atlassian_signin_required';

/** The kind of a streamed error that means the sign-in ran out in the middle of a question. */
const SIGN_IN_FAILURE = 'signin';

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
 * Keeps what the page knows about the Atlassian sign-in. Until the server says otherwise, nobody
 * needs to sign in: basic and bearer modes, and a page whose server has no sign-in, work as before.
 * @returns {{
 *   load: (status: import('./api.js').AuthStatus) => void,
 *   markNeeded: () => void,
 *   signedOut: () => void,
 *   view: () => SignInView,
 * }} The sign-in state.
 */
export function createSignInState() {
  /** @type {import('./api.js').AuthStatus | undefined} */
  let status;
  let needed = false;
  const isOauth = () => status?.mode === 'oauth';

  return {
    load(next) {
      status = next;
      needed = isOauth() && !next.signedIn;
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
      return { needed, account };
    },
  };
}
