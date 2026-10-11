// @ts-check
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createSecurityHeadersHook, SECURITY_HEADERS } from '../../src/server/headers.js';

/**
 * An app with the hook and a page and an API route.
 * @returns {Promise<import('fastify').FastifyInstance>} The app.
 */
async function appWithHook() {
  const app = Fastify();
  app.addHook('onRequest', createSecurityHeadersHook());
  app.get('/', async () => 'page');
  app.get('/api/ping', async () => ({ ok: true }));
  app.get('/apiary', async () => 'not the api');
  await app.ready();
  return app;
}

describe('SECURITY_HEADERS', () => {
  it('limits every kind of content to this server, forbids framing and a base tag', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe(
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
  });

  it('stops type sniffing and sends no referrer', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });

  it('allows no inline script or style', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('unsafe-inline');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SECURITY_HEADERS)).toBe(true);
  });
});

describe('createSecurityHeadersHook', () => {
  it('adds the security headers to the page', async () => {
    const app = await appWithHook();

    const { headers } = await app.inject({ url: '/' });

    expect(headers).toMatchObject({
      'content-security-policy': SECURITY_HEADERS['Content-Security-Policy'],
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
  });

  it('marks an API answer as never to be stored', async () => {
    const app = await appWithHook();

    const { headers } = await app.inject({ url: '/api/ping?x=1' });

    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('leaves the caching of the page alone', async () => {
    const app = await appWithHook();

    expect((await app.inject({ url: '/' })).headers['cache-control']).toBeUndefined();
    expect((await app.inject({ url: '/apiary' })).headers['cache-control']).toBeUndefined();
  });

  it('sends no CORS headers', async () => {
    const app = await appWithHook();

    const { headers } = await app.inject({
      url: '/api/ping',
      headers: { origin: 'https://other.example' },
    });

    expect(Object.keys(headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });
});
