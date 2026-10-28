// @ts-check
import { withLock } from './lock.js';
import { oauthErrorOf, postForm } from './http.js';

/**
 * What came of signing out. The sign-in file is gone either way; `revoked` says whether Atlassian
 * also confirmed that both tokens no longer work.
 * @typedef {object} SignOutResult
 * @property {boolean} revoked - True when both tokens were revoked, or there was nothing to revoke.
 */

/**
 * What signing out depends on.
 * @typedef {object} SignOutDeps
 * @property {import('./store.js').SignInStore} store - Where the sign-in is kept.
 * @property {import('./discovery.js').Discovery} discovery - Finds the revocation endpoint.
 * @property {typeof fetch} fetch - The fetch to use.
 * @property {{ now: () => number }} clock - Time source, for the lock.
 * @property {Pick<import('../logger/index.js').Logger, 'info' | 'warn'>} logger - Where the outcome is logged.
 * @property {Partial<import('./lock.js').LockOptions>} [lock] - Lock timings; only tests change them.
 */

/**
 * Asks Atlassian to revoke one token (RFC 7009). A failure is logged by its status and OAuth error
 * code only, and never thrown: signing out goes ahead regardless.
 * @param {SignOutDeps & { revocationEndpoint: string, clientId: string }} deps - Where and as whom.
 * @param {string} token - The token.
 * @param {'refresh_token' | 'access_token'} hint - Which kind it is.
 * @returns {Promise<boolean>} True when Atlassian confirmed it.
 */
async function revokeOne({ fetch, revocationEndpoint, clientId, logger }, token, hint) {
  try {
    const result = await postForm(
      fetch,
      revocationEndpoint,
      { token, token_type_hint: hint, client_id: clientId },
      'sign out of Atlassian',
    );
    if (!result.ok) {
      logger.warn(
        { hint, status: result.status, error: oauthErrorOf(result.body) },
        'Atlassian did not revoke a token',
      );
    }
    return result.ok;
  } catch {
    // postForm only throws when Atlassian cannot be reached.
    logger.warn({ hint }, 'could not reach Atlassian to revoke a token');
    return false;
  }
}

/**
 * Revokes both tokens, the refresh token first so the sign-in cannot be renewed.
 * @param {SignOutDeps} signOutDeps - The dependencies.
 * @param {import('./store.js').StoredSignIn} current - The sign-in.
 * @returns {Promise<boolean>} True when both were revoked.
 */
async function revokeBoth(signOutDeps, current) {
  const { store, discovery, logger } = signOutDeps;
  const client = await store.readClient();
  if (client === undefined) {
    logger.warn({}, 'there is no registration to revoke the tokens with');
    return false;
  }
  let server;
  try {
    server = await discovery.authorizationServer();
  } catch {
    logger.warn({}, 'could not find where to revoke the tokens');
    return false;
  }
  const target = {
    ...signOutDeps,
    revocationEndpoint: server.revocationEndpoint,
    clientId: client.clientId,
  };
  const refresh = await revokeOne(target, current.refreshToken, 'refresh_token');
  const access = await revokeOne(target, current.accessToken, 'access_token');
  return refresh && access;
}

/**
 * Signs out: revokes the refresh token, then the access token, then deletes the sign-in file. The
 * registration is kept, so the next sign-in needs no new one. The file is deleted even when
 * revoking fails, and the result says so. It runs under the same lock as a renewal, so a renewal
 * in another process cannot write the sign-in back after it was deleted.
 * @param {SignOutDeps} deps - Store, discovery, fetch, clock and logger.
 * @returns {Promise<SignOutResult>} Whether the tokens were revoked.
 */
export async function signOut(deps) {
  const { store, clock, logger, lock = {} } = deps;
  const signIn = await store.readSignIn();
  if (signIn === undefined) {
    await store.deleteSignIn();
    return { revoked: true };
  }
  return withLock(
    store.lockPath,
    async () => {
      // Read again under the lock: another process may have renewed it since.
      const current = (await store.readSignIn()) ?? signIn;
      const revoked = await revokeBoth(deps, current);
      await store.deleteSignIn();
      logger.info({ revoked }, 'signed out of Atlassian');
      return { revoked };
    },
    { clock, ...lock },
  ).catch(async () => {
    // The lock could not be taken; the sign-in is still removed, and is reported as not revoked.
    logger.warn({}, 'signed out without revoking: a renewal held the lock for too long');
    await store.deleteSignIn();
    return { revoked: false };
  });
}
