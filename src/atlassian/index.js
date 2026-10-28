// @ts-check

/** @typedef {import('./discovery.js').AuthorizationServer} AuthorizationServer */
/** @typedef {import('./discovery.js').Discovery} Discovery */
/** @typedef {import('./authorize.js').CallbackResult} CallbackResult */
/** @typedef {import('./authorize.js').TokenSet} TokenSet */
/** @typedef {import('./identity.js').SiteCheck} SiteCheck */
/** @typedef {import('./pending.js').StartedSignIn} StartedSignIn */
/** @typedef {import('./pending.js').TakenSignIn} TakenSignIn */
/** @typedef {import('./revoke.js').SignOutResult} SignOutResult */
/** @typedef {import('./signIn.js').SignInFlow} SignInFlow */
/** @typedef {import('./signIn.js').SignInOutcome} SignInOutcome */
/** @typedef {import('./store.js').SignInStore} SignInStore */
/** @typedef {import('./store.js').StoredClient} StoredClient */
/** @typedef {import('./store.js').StoredSignIn} StoredSignIn */
/** @typedef {import('./tokenEndpoint.js').TokenResult} TokenResult */
/** @typedef {import('./tokens.js').SignInStatus} SignInStatus */
/** @typedef {import('./tokens.js').TokenProvider} TokenProvider */

export {
  buildAuthorizeUrl,
  missingScopes,
  parseCallbackQuery,
  parseTokenResponse,
  reasonForOAuthError,
  REQUIRED_SCOPES,
  SCOPES,
} from './authorize.js';
export { CALLBACK_PATH, ensureClient, redirectUriFor } from './client.js';
export {
  authorizationServerMetadataUrl,
  createDiscovery,
  parseAuthorizationServer,
  parseProtectedResource,
  protectedResourceMetadataUrl,
} from './discovery.js';
export { checkSite, RESOURCES_TOOL } from './identity.js';
export { withLock } from './lock.js';
export { createPendingSignIns, PENDING_SIGN_IN_MS } from './pending.js';
export { challengeFor, createPkce, randomToken } from './pkce.js';
export { signOut } from './revoke.js';
export { createSignInFlow } from './signIn.js';
export { createSignInStore } from './store.js';
export { exchangeCode, refreshTokens } from './tokenEndpoint.js';
export { createTokenProvider } from './tokens.js';
