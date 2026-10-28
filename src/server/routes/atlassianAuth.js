// @ts-check
import { CALLBACK_PATH, PENDING_SIGN_IN_MS } from '../../atlassian/index.js';
import { renderSignInErrorPage, START_PATH } from '../authPages.js';
import { createAuthNavigationHook } from '../guards.js';

/** The answer to a request that needs an Atlassian sign-in when there is none that works. */
export const SIGN_IN_REQUIRED = Object.freeze({
  code: 'atlassian_signin_required',
  message: 'Sign in with Atlassian to keep going.',
});

/** HTTP status for a request that needs a sign-in. */
export const UNAUTHORIZED = 401;

/** Where a finished sign-in, and a status check, take the person. */
const HOME = '/';
const STATUS_PATH = '/api/auth/status';
const LOGOUT_PATH = '/api/auth/atlassian/logout';

const FOUND = 302;
const BAD_REQUEST = 400;
const BAD_GATEWAY = 502;
const NO_STORE = 'no-store';
const HTML_TYPE = 'text/html; charset=utf-8';

/**
 * The cookie that ties a sign-in to the browser that started it. It is sent back only to the
 * sign-in routes, only by this browser, and only for as long as the sign-in may take.
 */
const NONCE_COOKIE = 'atlassian_sign_in';
const COOKIE_ATTRIBUTES = `HttpOnly; SameSite=Lax; Path=/auth/atlassian`;
const NONCE_PATTERN = /^[\w-]{43}$/;
const MS_PER_SECOND = 1000;

/** The only host the sign-in comes back to; a sign-in started on another is moved there first. */
const CALLBACK_HOST = '127.0.0.1';
const LOCALHOST = 'localhost';

/** A body with nothing in it. The page sends `{}`, because a JSON request may not be empty. */
const EMPTY_BODY_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false });

/**
 * Builds the cookie that holds a pending sign-in's nonce.
 * @param {string} nonce - The nonce.
 * @returns {string} The Set-Cookie value.
 */
export function nonceCookie(nonce) {
  const maxAge = PENDING_SIGN_IN_MS / MS_PER_SECOND;
  return `${NONCE_COOKIE}=${nonce}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`;
}

/** The Set-Cookie value that removes the nonce: it is used once, whatever the outcome. */
export const CLEAR_NONCE_COOKIE = `${NONCE_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;

/**
 * Reads the nonce from a Cookie header. Anything not shaped like a nonce counts as none.
 * @param {unknown} header - The Cookie header.
 * @returns {string | undefined} The nonce.
 */
export function readNonce(header) {
  if (typeof header !== 'string') {
    return undefined;
  }
  const prefix = `${NONCE_COOKIE}=`;
  const value = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return value !== undefined && NONCE_PATTERN.test(value) ? value : undefined;
}

/**
 * Whether a Host header names localhost, on any port.
 * @param {unknown} host - The Host header.
 * @returns {boolean} True for `localhost:<port>`.
 */
function isLocalhost(host) {
  return typeof host === 'string' && host.toLowerCase().split(':')[0] === LOCALHOST;
}

/**
 * What the sign-in routes need, all injected.
 * @typedef {object} AtlassianAuthRouteDeps
 * @property {import('../../atlassian/index.js').SignInFlow} flow - Starts and finishes a sign-in.
 * @property {Pick<import('../../atlassian/index.js').TokenProvider, 'status'>} tokens - Says whether someone is signed in.
 * @property {() => Promise<import('../../atlassian/index.js').SignOutResult>} signOut - Revokes and deletes the sign-in.
 * @property {() => Promise<void>} endActiveConversation - Ends the open conversation on sign-out.
 * @property {import('../guards.js').GuardPolicy} policy - What counts as this server.
 * @property {number} port - The port the app listens on.
 * @property {string} siteHost - The configured Atlassian site's host, for the error page.
 * @property {Pick<import('../../logger/index.js').Logger, 'info' | 'warn' | 'error'>} logger - Where to log.
 */

/**
 * Registers `GET /api/auth/status`, in every mode. In basic and bearer modes the service account
 * is always "signed in"; in oauth mode the answer comes from the sign-in file, with no network
 * call. It never holds a token.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {{ mode: string, tokens?: Pick<import('../../atlassian/index.js').TokenProvider, 'status'> }} deps - The mode, and the provider in oauth mode.
 */
export function registerAuthStatusRoute(app, { mode, tokens }) {
  app.get(STATUS_PATH, async () => {
    if (tokens === undefined) {
      return { mode, signedIn: true };
    }
    return { mode, ...(await tokens.status()) };
  });
}

/**
 * Registers the oauth-mode routes: starting a sign-in, Atlassian's callback, and signing out. They
 * exist only in oauth mode; otherwise these paths are not found.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {AtlassianAuthRouteDeps} deps - Dependencies.
 */
export function registerAtlassianAuthRoutes(app, deps) {
  const { flow, signOut, endActiveConversation, policy, port, siteHost, logger } = deps;

  /**
   * Answers with the sign-in error page.
   * @param {import('fastify').FastifyReply} reply - The reply.
   * @param {number} status - The status.
   * @param {import('../../errors/index.js').AtlassianAuthReason} reason - Why the sign-in did not complete.
   * @returns {import('fastify').FastifyReply} The reply.
   */
  function errorPage(reply, status, reason) {
    return reply.code(status).type(HTML_TYPE).send(renderSignInErrorPage(reason, siteHost));
  }

  app.get(
    START_PATH,
    {
      // HEAD would start a sign-in too; only a real navigation may.
      exposeHeadRoute: false,
      onRequest: createAuthNavigationHook({ policy, logger, allowCrossSite: false }),
    },
    async (request, reply) => {
      reply.header('Cache-Control', NO_STORE);
      if (isLocalhost(request.headers.host)) {
        // The sign-in comes back to 127.0.0.1, so it must start there, or its cookie is lost.
        return reply.redirect(`http://${CALLBACK_HOST}:${port}${START_PATH}`, FOUND);
      }
      try {
        const { authorizeUrl, nonce } = await flow.start();
        return reply.header('Set-Cookie', nonceCookie(nonce)).redirect(authorizeUrl, FOUND);
      } catch (error) {
        logger.warn(
          { detail: error instanceof Error ? error.message : 'unknown' },
          'could not start signing in',
        );
        return errorPage(reply, BAD_GATEWAY, 'failed');
      }
    },
  );

  app.get(
    CALLBACK_PATH,
    {
      exposeHeadRoute: false,
      onRequest: createAuthNavigationHook({ policy, logger, allowCrossSite: true }),
    },
    async (request, reply) => {
      reply.header('Cache-Control', NO_STORE).header('Set-Cookie', CLEAR_NONCE_COOKIE);
      const outcome = await flow.finish({
        query: /** @type {Record<string, unknown>} */ (request.query),
        nonce: readNonce(request.headers.cookie),
      });
      return outcome.ok
        ? reply.redirect(HOME, FOUND)
        : errorPage(reply, BAD_REQUEST, outcome.reason);
    },
  );

  app.post(LOGOUT_PATH, { schema: { body: EMPTY_BODY_SCHEMA } }, async () => {
    const { revoked } = await signOut();
    await endActiveConversation();
    return { signedOut: true, revoked };
  });
}
