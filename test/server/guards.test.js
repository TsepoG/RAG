// @ts-check
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  checkRequest,
  createGuardHook,
  createGuardPolicy,
  isGuardedPath,
} from '../../src/server/guards.js';

const LOOPBACK = ['127', '0', '0', '1'].join('.');
const PORT = 3000;
const SCHEME = 'http:';
const own = `${LOOPBACK}:${PORT}`;
const ownOrigin = `${SCHEME}//${own}`;

/**
 * A policy for a server listening as given.
 * @param {{ host?: string, allowRemote?: boolean }} [options] - How it listens.
 * @returns {import('../../src/server/guards.js').GuardPolicy} The policy.
 */
function policy({ host = LOOPBACK, allowRemote = false } = {}) {
  return createGuardPolicy({ host, port: PORT, allowRemote });
}

/**
 * Checks a request.
 * @param {Record<string, string | undefined>} headers - Request headers, host defaulting to the server's own.
 * @param {string} [method] - HTTP method.
 * @param {import('../../src/server/guards.js').GuardPolicy} [thePolicy] - The policy.
 * @returns {string | undefined} The refusal reason, if any.
 */
function check(headers, method = 'GET', thePolicy = policy()) {
  return checkRequest({ method, headers: { host: own, ...headers } }, thePolicy);
}

describe('createGuardPolicy', () => {
  it('accepts the loopback address and localhost on the port in use', () => {
    expect([...policy().hosts].sort()).toEqual([`localhost:${PORT}`, own].sort());
  });

  it('accepts the matching origins', () => {
    expect(policy().origins).toEqual(new Set([ownOrigin, `${SCHEME}//localhost:${PORT}`]));
  });

  it('adds a loopback host that is set, such as [::1]', () => {
    expect(policy({ host: '[::1]' }).hosts.has(`[::1]:${PORT}`)).toBe(true);
  });

  it('adds the configured host only when remote access is on', () => {
    expect(policy({ host: 'myhost.internal' }).hosts.has(`myhost.internal:${PORT}`)).toBe(false);
    expect(
      policy({ host: 'myhost.internal', allowRemote: true }).hosts.has(`myhost.internal:${PORT}`),
    ).toBe(true);
  });
});

describe('isGuardedPath', () => {
  it.each([
    ['/api', true],
    ['/api/ask', true],
    ['/api/ask?x=1', true],
    ['/apiary', false],
    ['/', false],
    ['/js/main.js', false],
  ])('%s is guarded: %s', (path, guarded) => {
    expect(isGuardedPath(path)).toBe(guarded);
  });
});

describe('checkRequest', () => {
  it('lets through a request addressed to this machine', () => {
    expect(check({})).toBeUndefined();
  });

  it('is not case sensitive about the host', () => {
    expect(check({ host: `LOCALHOST:${PORT}` })).toBeUndefined();
  });

  it.each([
    ['another name', `evil.example:${PORT}`],
    ['another port', `${LOOPBACK}:4000`],
    ['no port', LOOPBACK],
    ['a look-alike', `${LOOPBACK}.evil.example:${PORT}`],
  ])('refuses a Host with %s (DNS rebinding)', (_name, host) => {
    expect(check({ host })).toBe('host');
  });

  it('refuses a request with no Host', () => {
    expect(checkRequest({ method: 'GET', headers: {} }, policy())).toBe('host');
  });

  it('refuses a request another site started', () => {
    expect(check({ 'sec-fetch-site': 'cross-site' })).toBe('cross-site');
  });

  it.each(['same-origin', 'same-site', 'none', undefined])('allows Sec-Fetch-Site %s', (value) => {
    expect(check({ 'sec-fetch-site': value })).toBeUndefined();
  });

  it('allows an Origin that is the server itself, and none at all', () => {
    expect(check({ origin: ownOrigin })).toBeUndefined();
    expect(check({ origin: ownOrigin.toUpperCase() })).toBeUndefined();
  });

  it.each([
    ['another site', `${SCHEME}//evil.example`],
    ['the same host on another port', `${SCHEME}//${LOOPBACK}:4000`],
    ['a look-alike', `${ownOrigin}.evil.example`],
    ['null', 'null'],
    ['an empty value', ''],
  ])('refuses an Origin that is %s', (_name, origin) => {
    expect(check({ origin })).toBe('origin');
  });

  it('refuses a repeated Origin header', () => {
    const headers = /** @type {any} */ ({ host: own, origin: [ownOrigin, ownOrigin] });

    expect(checkRequest({ method: 'GET', headers }, policy())).toBe('origin');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('needs JSON for %s', (method) => {
    expect(check({ 'content-type': 'text/plain' }, method)).toBe('content-type');
    expect(check({}, method)).toBe('content-type');
  });

  it('accepts JSON with a charset, in any case', () => {
    expect(check({ 'content-type': 'Application/JSON; charset=utf-8' }, 'POST')).toBeUndefined();
  });

  it('does not accept a type that only starts like JSON', () => {
    expect(check({ 'content-type': 'application/jsonp' }, 'POST')).toBe('content-type');
    expect(check({ 'content-type': 'text/plain; x=application/json' }, 'POST')).toBe(
      'content-type',
    );
  });

  it('does not ask for a content type on a request that only reads', () => {
    expect(check({}, 'GET')).toBeUndefined();
    expect(check({}, 'HEAD')).toBeUndefined();
    expect(check({}, 'OPTIONS')).toBeUndefined();
  });

  it('reports the host first when several things are wrong', () => {
    expect(check({ host: 'evil.example', origin: 'null', 'sec-fetch-site': 'cross-site' })).toBe(
      'host',
    );
  });
});

describe('createGuardHook', () => {
  /**
   * An app with the hook and two routes.
   * @returns {Promise<{ app: import('fastify').FastifyInstance, warn: import('vitest').Mock }>} The app.
   */
  async function appWithHook() {
    const warn = vi.fn();
    const app = Fastify();
    app.addHook('onRequest', createGuardHook({ policy: policy(), logger: { warn } }));
    app.get('/api/ping', async () => ({ ok: true }));
    app.post('/api/ask', async () => ({ ok: true }));
    app.get('/page', async () => 'page');
    await app.ready();
    return { app, warn };
  }

  it('lets a good request reach the route', async () => {
    const { app } = await appWithHook();

    const response = await app.inject({ url: '/api/ping', headers: { host: own } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('answers 403 with a short JSON message for a foreign Origin, and logs only the reason', async () => {
    const { app, warn } = await appWithHook();
    const evil = `${SCHEME}//evil.example`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/ask',
      payload: '{}',
      headers: { host: own, origin: evil, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ message: 'Requests from another origin are not allowed.' });
    expect(warn).toHaveBeenCalledWith({ reason: 'origin', method: 'POST' }, 'refused a request');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('evil.example');
  });

  it('refuses a rebinding Host, a cross-site request and a body that is not JSON', async () => {
    const { app } = await appWithHook();

    const rebinding = await app.inject({ url: '/api/ping', headers: { host: 'evil.example' } });
    const crossSite = await app.inject({
      url: '/api/ping',
      headers: { host: own, 'sec-fetch-site': 'cross-site' },
    });
    const notJson = await app.inject({
      method: 'POST',
      url: '/api/ask',
      payload: 'x',
      headers: { host: own, 'content-type': 'text/plain' },
    });

    expect([rebinding, crossSite, notJson].map(({ statusCode }) => statusCode)).toEqual([
      403, 403, 403,
    ]);
  });

  it('does not guard the page itself', async () => {
    const { app } = await appWithHook();

    const response = await app.inject({ url: '/page', headers: { host: 'evil.example' } });

    expect(response.statusCode).toBe(200);
  });
});
