// @ts-check
import { isLoopbackHost } from '../config/index.js';

/** Only paths under this prefix are guarded; the page and its files are public to this machine. */
const API_PREFIX = '/api';

/** The scheme the server speaks; an Origin must use it. */
const ORIGIN_SCHEME = 'http:';

/** Methods that only read. Every other method counts as changing something. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The only content type a request that changes something may send. */
const JSON_TYPE = 'application/json';

/** The value of `Sec-Fetch-Site` that browsers send for a request started by another site. */
const CROSS_SITE = 'cross-site';

/** HTTP status for a refused request. */
const FORBIDDEN = 403;

/**
 * Why a request was refused. Only these codes are logged, never the header values.
 * @typedef {'host' | 'cross-site' | 'origin' | 'content-type'} GuardReason
 */

/** What the person is told for each reason. Short, and the same for every caller. */
const MESSAGES = Object.freeze({
  host: 'This server only answers requests addressed to this machine.',
  'cross-site': 'Requests started by another site are not allowed.',
  origin: 'Requests from another origin are not allowed.',
  'content-type': 'The request must be sent as application/json.',
});

/**
 * The addresses this server answers to, and the origins that count as its own.
 * @typedef {object} GuardPolicy
 * @property {ReadonlySet<string>} hosts - Allowed `Host` header values, lower-case.
 * @property {ReadonlySet<string>} origins - Allowed `Origin` header values, lower-case.
 */

/**
 * Works out which `Host` and `Origin` values belong to this server. These are 127.0.0.1 and
 * localhost on the port in use, plus the configured host when it is a loopback address or when
 * remote access was switched on. A forged Host (DNS rebinding) is none of these.
 * @param {{ host: string, port: number, allowRemote: boolean }} server - How the server listens.
 * @returns {GuardPolicy} The policy.
 */
export function createGuardPolicy({ host, port, allowRemote }) {
  const names = ['127.0.0.1', 'localhost'];
  if (allowRemote || isLoopbackHost(host)) {
    names.push(host);
  }
  const hosts = new Set(names.map((name) => `${name}:${port}`.toLowerCase()));
  const origins = new Set([...hosts].map((value) => `${ORIGIN_SCHEME}//${value}`));
  return { hosts, origins };
}

/**
 * Whether a request is addressed to a path the guards cover.
 * @param {string} url - The request URL, with any query.
 * @returns {boolean} True for `/api` and everything under it.
 */
export function isGuardedPath(url) {
  const path = url.split('?')[0];
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/**
 * Reads the media type from a Content-Type header, without parameters such as the charset.
 * @param {unknown} header - The header value.
 * @returns {string} The lower-case media type, or an empty string.
 */
function mediaType(header) {
  return typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '';
}

/**
 * Checks a request against the policy.
 * @param {{ method: string, headers: Readonly<Record<string, string | string[] | undefined>> }} request - The request.
 * @param {GuardPolicy} policy - What counts as this server.
 * @returns {GuardReason | undefined} Why it is refused, or undefined when it may go on.
 */
export function checkRequest({ method, headers }, policy) {
  const { host, origin } = headers;
  if (typeof host !== 'string' || !policy.hosts.has(host.toLowerCase())) {
    return 'host';
  }
  // A missing header is allowed so curl and tests work; browsers always send it.
  if (headers['sec-fetch-site'] === CROSS_SITE) {
    return 'cross-site';
  }
  if (
    origin !== undefined &&
    !(typeof origin === 'string' && policy.origins.has(origin.toLowerCase()))
  ) {
    return 'origin';
  }
  const changes = !SAFE_METHODS.has(method.toUpperCase());
  if (changes && mediaType(headers['content-type']) !== JSON_TYPE) {
    return 'content-type';
  }
  return undefined;
}

/**
 * Builds the Fastify hook that refuses a request to `/api/*` that fails the guards, with a 403
 * and a short JSON message. The reason code is logged at warn, never the header values.
 * @param {{ policy: GuardPolicy, logger: Pick<import('../logger/index.js').Logger, 'warn'> }} deps - Dependencies.
 * @returns {import('fastify').onRequestAsyncHookHandler} The hook.
 */
export function createGuardHook({ policy, logger }) {
  return async (request, reply) => {
    if (!isGuardedPath(request.url)) {
      return;
    }
    const reason = checkRequest(request, policy);
    if (reason === undefined) {
      return;
    }
    logger.warn({ reason, method: request.method }, 'refused a request');
    await reply.code(FORBIDDEN).send({ message: MESSAGES[reason] });
  };
}
