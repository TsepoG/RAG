// @ts-check

/** @typedef {import('./discovery.js').AuthorizationServer} AuthorizationServer */
/** @typedef {import('./authorize.js').CallbackResult} CallbackResult */
/** @typedef {import('./authorize.js').TokenSet} TokenSet */
/** @typedef {import('./pending.js').StartedSignIn} StartedSignIn */
/** @typedef {import('./pending.js').TakenSignIn} TakenSignIn */

export {
  buildAuthorizeUrl,
  missingScopes,
  parseCallbackQuery,
  parseTokenResponse,
  reasonForOAuthError,
  REQUIRED_SCOPES,
  SCOPES,
} from './authorize.js';
export {
  authorizationServerMetadataUrl,
  parseAuthorizationServer,
  parseProtectedResource,
  protectedResourceMetadataUrl,
} from './discovery.js';
export { createPendingSignIns, PENDING_SIGN_IN_MS } from './pending.js';
export { challengeFor, createPkce, randomToken } from './pkce.js';
