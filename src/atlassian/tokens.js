// @ts-check
import { AtlassianSignInRequiredError } from '../errors/index.js';
import { describeRefusal } from './http.js';
import { withLock } from './lock.js';
import { refreshTokens } from './tokenEndpoint.js';

/** Refusals that mean the stored sign-in can never be renewed: it is removed. */
const DEAD_GRANT = 'invalid_grant';
const UNKNOWN_CLIENT = 'invalid_client';

/**
 * What the page may be told about the sign-in. It never holds a token.
 * @typedef {{ signedIn: false } | { signedIn: true, expiresAt: number, siteHost: string }} SignInStatus
 */

/**
 * Hands out the signed-in person's access token, renewing it when it is about to run out.
 * @typedef {object} TokenProvider
 * @property {(options: { minValidityMs: number }) => Promise<{ accessToken: string, expiresAt: number }>} getAtlassianToken -
 *   A token valid for at least `minValidityMs` more. Throws AtlassianSignInRequiredError when there
 *   is no sign-in, or it cannot be renewed.
 * @property {() => Promise<SignInStatus>} status - Whether someone is signed in, read from the file
 *   with no network call. A sign-in whose access token has run out still counts: it can be renewed.
 */

/**
 * What the provider depends on.
 * @typedef {object} TokenProviderDeps
 * @property {import('./store.js').SignInStore} store - Where the sign-in is kept.
 * @property {import('./discovery.js').Discovery} discovery - Finds the token endpoint.
 * @property {typeof fetch} fetch - The fetch to use.
 * @property {{ now: () => number }} clock - Time source, in ms.
 * @property {Pick<import('../logger/index.js').Logger, 'info' | 'warn'>} logger - Where renewals are logged.
 * @property {Partial<import('./lock.js').LockOptions>} [lock] - Lock timings; only tests change them.
 */

/**
 * Picks out the token and its expiry from a sign-in.
 * @param {import('./store.js').StoredSignIn} signIn - The sign-in.
 * @returns {{ accessToken: string, expiresAt: number }} The token.
 */
function tokenOf({ accessToken, expiresAt }) {
  return { accessToken, expiresAt };
}

/**
 * Creates the one place the access token comes from.
 * - A token with enough time left is handed out as it is, with no network call.
 * - Otherwise it is renewed: once at a time in this process (every caller waits for the same
 *   renewal), and under a lock file shared with other processes. Under the lock the file is read
 *   again, because another process may have renewed it already.
 * - Atlassian replaces the refresh token on every renewal and the old one stops working, so the new
 *   tokens are saved before they are handed out.
 * - When the refresh token is refused (`invalid_grant`), the file is read once more in case another
 *   process rotated it in the meantime; if not, the sign-in is removed and the person must sign in
 *   again. Any other failure keeps the sign-in, so a later attempt can still renew it.
 * - Every failure to renew is reported as AtlassianSignInRequiredError, with the reason as its
 *   cause: the turn is refused and the page offers to sign in again.
 * @param {TokenProviderDeps} deps - Store, discovery, fetch, clock and logger.
 * @returns {TokenProvider} The provider.
 */
export function createTokenProvider({ store, discovery, fetch, clock, logger, lock = {} }) {
  /** @type {Promise<import('./store.js').StoredSignIn> | undefined} */
  let renewing;

  /**
   * Whether a sign-in has at least the given time left.
   * @param {import('./store.js').StoredSignIn} signIn - The sign-in.
   * @param {number} minValidityMs - The time it must have left.
   * @returns {boolean} True when it can be used as it is.
   */
  function isFresh(signIn, minValidityMs) {
    return signIn.expiresAt - clock.now() > minValidityMs;
  }

  /**
   * Handles a refusal from the token endpoint. Always throws.
   * @param {{ status: number, error: string | undefined }} refusal - The refusal.
   * @param {import('./store.js').StoredSignIn} used - The sign-in whose refresh token was refused.
   * @param {number} minValidityMs - The time a usable sign-in must have left.
   * @returns {Promise<import('./store.js').StoredSignIn>} A sign-in another process renewed, if any.
   * @throws {AtlassianSignInRequiredError} When the sign-in cannot be renewed.
   */
  async function handleRefusal(refusal, used, minValidityMs) {
    const reason = describeRefusal('renew the Atlassian sign-in', refusal.status, refusal.error);
    logger.warn(
      { status: refusal.status, error: refusal.error },
      'could not renew the Atlassian sign-in',
    );
    if (refusal.error === DEAD_GRANT) {
      const latest = await store.readSignIn();
      if (
        latest !== undefined &&
        latest.refreshToken !== used.refreshToken &&
        isFresh(latest, minValidityMs)
      ) {
        return latest;
      }
      await store.deleteSignIn();
    } else if (refusal.error === UNKNOWN_CLIENT) {
      await store.deleteSignIn();
      await store.deleteClient();
    }
    throw new AtlassianSignInRequiredError({ cause: new Error(reason) });
  }

  /**
   * Renews the sign-in under the lock.
   * @param {number} minValidityMs - The time the token must have left.
   * @returns {Promise<import('./store.js').StoredSignIn>} The renewed sign-in.
   */
  function renew(minValidityMs) {
    return withLock(
      store.lockPath,
      async () => {
        const current = await store.readSignIn();
        const client = await store.readClient();
        if (current === undefined || client === undefined) {
          throw new AtlassianSignInRequiredError();
        }
        if (isFresh(current, minValidityMs)) {
          return current;
        }
        const { tokenEndpoint } = await discovery.authorizationServer();
        const result = await refreshTokens({
          fetch,
          tokenEndpoint,
          clientId: client.clientId,
          refreshToken: current.refreshToken,
          clock,
        });
        if (!result.ok) {
          return handleRefusal(result, current, minValidityMs);
        }
        const { tokens } = result;
        const renewed = {
          ...current,
          accessToken: tokens.accessToken,
          // An answer without a new refresh token leaves the old one in use.
          refreshToken: tokens.refreshToken ?? current.refreshToken,
          expiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
        };
        await store.writeSignIn(renewed);
        logger.info({ expiresAt: renewed.expiresAt }, 'renewed the Atlassian sign-in');
        return renewed;
      },
      { clock, ...lock },
    );
  }

  return {
    async getAtlassianToken({ minValidityMs }) {
      const signIn = await store.readSignIn();
      if (signIn === undefined) {
        throw new AtlassianSignInRequiredError();
      }
      if (isFresh(signIn, minValidityMs)) {
        return tokenOf(signIn);
      }
      renewing ??= renew(minValidityMs)
        .catch((error) => {
          // Whatever stopped the renewal (Atlassian out of reach, the lock held too long), the
          // person cannot go on without signing in again; the sign-in file is kept unless the
          // refresh token itself was refused.
          throw error instanceof AtlassianSignInRequiredError
            ? error
            : new AtlassianSignInRequiredError({ cause: error });
        })
        .finally(() => {
          renewing = undefined;
        });
      return tokenOf(await renewing);
    },
    async status() {
      const signIn = await store.readSignIn();
      return signIn === undefined
        ? { signedIn: false }
        : { signedIn: true, expiresAt: signIn.expiresAt, siteHost: signIn.siteHost };
    },
  };
}
