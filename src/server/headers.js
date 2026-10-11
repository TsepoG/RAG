// @ts-check

/**
 * Everything on the page comes from this server. Nothing is inline, so scripts and styles are
 * limited to files served from here. Images may be data: URIs; no other origin is trusted, and
 * the page cannot be framed.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Sent with every response. There are deliberately no CORS headers: no other site may read it.
 * @type {Readonly<Record<string, string>>}
 */
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

/**
 * Builds the hook that adds the security headers to every response. Answers from `/api/*` are
 * also marked as never to be stored.
 * @returns {import('fastify').onRequestHookHandler} The hook.
 */
export function createSecurityHeadersHook() {
  return (request, reply, done) => {
    reply.headers(SECURITY_HEADERS);
    const path = request.url.split('?')[0];
    if (path === '/api' || path.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
    done();
  };
}
