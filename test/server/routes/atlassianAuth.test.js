// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';
import { createLogger } from '../../../src/logger/index.js';
import { createAnswerMemory } from '../../../src/server/answers.js';
import { buildApp } from '../../../src/server/app.js';
import {
  CLEAR_NONCE_COOKIE,
  nonceCookie,
  readNonce,
} from '../../../src/server/routes/atlassianAuth.js';
import { oauthEnv, validEnv } from '../../helpers/env.js';
import { createMemoryStream } from '../../helpers/memory-stream.js';
import { makeRole } from '../../helpers/role.js';
import { JSON_HEADERS, OWN_HOST, PORT } from '../../helpers/server.js';

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize?client_id=client-123&state=s';
const NONCE = 'N'.repeat(43);
const START = '/auth/atlassian/start';
const CALLBACK = '/auth/atlassian/callback';
const STATUS = '/api/auth/status';
const LOGOUT = '/api/auth/atlassian/logout';
const FAKE_TOKEN = 'fake-access-token-never-sent';

/**
 * Builds an oauth-mode app whose sign-in is made of fakes.
 * @param {object} [options] - What to change.
 * @param {{ start?: import('vitest').Mock, finish?: import('vitest').Mock }} [options.flow] - The flow's halves to replace.
 * @param {import('../../../src/atlassian/index.js').SignInStatus} [options.status] - The sign-in status.
 * @returns {{ app: import('fastify').FastifyInstance, flow: { start: import('vitest').Mock, finish: import('vitest').Mock }, signOut: import('vitest').Mock, endActiveConversation: import('vitest').Mock, lines: () => Array<Record<string, unknown>> }} The app and its doubles.
 */
function oauthApp({ flow = {}, status = { signedIn: false } } = {}) {
  const fakeFlow = {
    start: vi.fn(async () => ({ authorizeUrl: AUTHORIZE_URL, nonce: NONCE })),
    finish: vi.fn(async () => ({ ok: true })),
    ...flow,
  };
  const signOut = vi.fn(async () => ({ revoked: true }));
  const endActiveConversation = vi.fn(async () => undefined);
  const { stream, lines } = createMemoryStream();
  const app = buildApp({
    config: loadConfig(oauthEnv()),
    roles: new Map([['tester', makeRole()]]),
    ask: vi.fn(),
    answers: createAnswerMemory(),
    saveFeedback: vi.fn(),
    atlassianAuth: {
      flow: /** @type {import('../../../src/atlassian/index.js').SignInFlow} */ (fakeFlow),
      tokens: { status: async () => status },
      signOut,
      endActiveConversation,
    },
    staticFiles: new Map(),
    logger: createLogger({ level: 'debug', destination: stream }),
  });
  return { app, flow: fakeFlow, signOut, endActiveConversation, lines };
}

describe('the nonce cookie', () => {
  it('is HttpOnly, SameSite=Lax, limited to the sign-in routes and to ten minutes', () => {
    expect(nonceCookie(NONCE)).toBe(
      `atlassian_sign_in=${NONCE}; HttpOnly; SameSite=Lax; Path=/auth/atlassian; Max-Age=600`,
    );
    expect(CLEAR_NONCE_COOKIE).toBe(
      'atlassian_sign_in=; HttpOnly; SameSite=Lax; Path=/auth/atlassian; Max-Age=0',
    );
  });

  it('is read from among other cookies', () => {
    expect(readNonce(`a=1; atlassian_sign_in=${NONCE}; b=2`)).toBe(NONCE);
  });

  it.each([
    ['no header', undefined],
    ['no such cookie', 'a=1'],
    ['a value of another shape', 'atlassian_sign_in=short'],
    ['an empty value', 'atlassian_sign_in='],
  ])('is absent with %s', (_label, header) => {
    expect(readNonce(header)).toBeUndefined();
  });
});

describe('GET /auth/atlassian/start', () => {
  it('sets the nonce cookie and sends the browser to Atlassian, never to be stored', async () => {
    const { app } = oauthApp();

    const response = await app.inject({
      method: 'GET',
      url: START,
      headers: { host: OWN_HOST, 'sec-fetch-site': 'same-origin' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(AUTHORIZE_URL);
    expect(response.headers['set-cookie']).toBe(nonceCookie(NONCE));
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each(['none', undefined])(
    'accepts a navigation typed in (Sec-Fetch-Site %s)',
    async (site) => {
      const { app } = oauthApp();
      /** @type {Record<string, string>} */
      const headers = { host: OWN_HOST };
      if (site !== undefined) {
        headers['sec-fetch-site'] = site;
      }

      expect((await app.inject({ method: 'GET', url: START, headers })).statusCode).toBe(302);
    },
  );

  it.each(['cross-site', 'same-site'])(
    'is refused when started from another site (%s), so no login CSRF',
    async (site) => {
      const { app, flow } = oauthApp();

      const response = await app.inject({
        method: 'GET',
        url: START,
        headers: { host: OWN_HOST, 'sec-fetch-site': site },
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(flow.start).not.toHaveBeenCalled();
    },
  );

  it('is refused for a Host that is not this server', async () => {
    const { app, flow } = oauthApp();

    const response = await app.inject({
      method: 'GET',
      url: START,
      headers: { host: 'evil.example:3000' },
    });

    expect(response.statusCode).toBe(403);
    expect(flow.start).not.toHaveBeenCalled();
  });

  it('moves a sign-in started on localhost to 127.0.0.1 first', async () => {
    const { app, flow } = oauthApp();

    const response = await app.inject({
      method: 'GET',
      url: `${START}?next=elsewhere`,
      headers: { host: `localhost:${PORT}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`http://127.0.0.1:${PORT}${START}`);
    expect(flow.start).not.toHaveBeenCalled();
  });

  it('shows the error page when Atlassian cannot be reached', async () => {
    const { app, lines } = oauthApp({
      flow: {
        start: vi.fn(async () => {
          throw new Error('Could not read the MCP server metadata (HTTP 503)');
        }),
      },
    });

    const response = await app.inject({ method: 'GET', url: START, headers: { host: OWN_HOST } });

    expect(response.statusCode).toBe(502);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.body).toContain('Something went wrong while signing in to Atlassian.');
    expect(lines()).toContainEqual(
      expect.objectContaining({ detail: 'Could not read the MCP server metadata (HTTP 503)' }),
    );
  });

  it('logs an unexpected failure without its details', async () => {
    const { app, lines } = oauthApp({
      flow: {
        start: vi.fn(async () => {
          throw 'odd';
        }),
      },
    });

    await app.inject({ method: 'GET', url: START, headers: { host: OWN_HOST } });

    expect(lines()).toContainEqual(expect.objectContaining({ detail: 'unknown' }));
  });

  it('does not answer HEAD, which would start a sign-in', async () => {
    const { app, flow } = oauthApp();

    await app.inject({ method: 'HEAD', url: START, headers: { host: OWN_HOST } });

    expect(flow.start).not.toHaveBeenCalled();
  });
});

describe('GET /auth/atlassian/callback', () => {
  const query = `?code=fake-code&state=${'S'.repeat(43)}`;

  it('accepts a navigation from Atlassian, passes on the query and cookie, and goes home', async () => {
    const { app, flow } = oauthApp();

    const response = await app.inject({
      method: 'GET',
      url: `${CALLBACK}${query}`,
      headers: {
        host: OWN_HOST,
        'sec-fetch-site': 'cross-site',
        cookie: `atlassian_sign_in=${NONCE}`,
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']).toBe(CLEAR_NONCE_COOKIE);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(flow.finish).toHaveBeenCalledWith({
      query: { code: 'fake-code', state: 'S'.repeat(43) },
      nonce: NONCE,
    });
  });

  it('passes on a missing cookie as none', async () => {
    const { app, flow } = oauthApp();

    await app.inject({ method: 'GET', url: `${CALLBACK}${query}`, headers: { host: OWN_HOST } });

    expect(flow.finish).toHaveBeenCalledWith(expect.objectContaining({ nonce: undefined }));
  });

  it('shows why the sign-in did not complete, clears the cookie, and echoes nothing', async () => {
    const { app } = oauthApp({
      flow: { finish: vi.fn(async () => ({ ok: false, reason: 'cancelled' })) },
    });

    const response = await app.inject({
      method: 'GET',
      url: `${CALLBACK}?error=access_denied&error_description=%3Cscript%3Efake-echo%3C%2Fscript%3E`,
      headers: { host: OWN_HOST, 'sec-fetch-site': 'cross-site' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['set-cookie']).toBe(CLEAR_NONCE_COOKIE);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('The sign-in was cancelled on the Atlassian page.');
    expect(response.body).not.toContain('fake-echo');
    expect(response.body).not.toContain('access_denied');
  });

  it('names the configured site when the account cannot reach it', async () => {
    const { app } = oauthApp({
      flow: { finish: vi.fn(async () => ({ ok: false, reason: 'wrong-site' })) },
    });

    const response = await app.inject({
      method: 'GET',
      url: CALLBACK,
      headers: { host: OWN_HOST },
    });

    // The apostrophe is escaped in the HTML.
    expect(response.body).toContain('This Atlassian account can&#39;t reach acme.atlassian.net.');
  });

  it('is refused for a Host that is not this server, even from Atlassian', async () => {
    const { app, flow } = oauthApp();

    const response = await app.inject({
      method: 'GET',
      url: `${CALLBACK}${query}`,
      headers: { host: 'evil.example', 'sec-fetch-site': 'cross-site' },
    });

    expect(response.statusCode).toBe(403);
    expect(flow.finish).not.toHaveBeenCalled();
  });

  it('accepts nothing but GET', async () => {
    const { app, flow } = oauthApp();

    const response = await app.inject({
      method: 'POST',
      url: `${CALLBACK}${query}`,
      headers: JSON_HEADERS,
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(flow.finish).not.toHaveBeenCalled();
  });

  it('never logs the code or the state', async () => {
    const { app, lines } = oauthApp({
      flow: { finish: vi.fn(async () => ({ ok: false, reason: 'failed' })) },
    });

    await app.inject({ method: 'GET', url: `${CALLBACK}${query}`, headers: { host: 'evil' } });
    await app.inject({ method: 'GET', url: `${CALLBACK}${query}`, headers: { host: OWN_HOST } });

    expect(JSON.stringify(lines())).not.toContain('fake-code');
  });
});

describe('the cross-site exception', () => {
  it('applies to the callback only: the API still refuses a cross-site request', async () => {
    const { app } = oauthApp();

    const response = await app.inject({
      method: 'GET',
      url: STATUS,
      headers: { host: OWN_HOST, 'sec-fetch-site': 'cross-site' },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/auth/status', () => {
  it('says nobody is signed in', async () => {
    const { app } = oauthApp();

    const response = await app.inject({ method: 'GET', url: STATUS, headers: { host: OWN_HOST } });

    expect(response.json()).toEqual({ mode: 'oauth', signedIn: false });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('gives the expiry and the site, and no token', async () => {
    const { app } = oauthApp({
      status: { signedIn: true, expiresAt: 123, siteHost: 'acme.atlassian.net' },
    });

    const response = await app.inject({ method: 'GET', url: STATUS, headers: { host: OWN_HOST } });

    expect(response.json()).toEqual({
      mode: 'oauth',
      signedIn: true,
      expiresAt: 123,
      siteHost: 'acme.atlassian.net',
    });
    expect(response.body).not.toContain(FAKE_TOKEN);
  });

  it.each(['basic', 'bearer'])(
    'says the service account is signed in, in %s mode',
    async (mode) => {
      const app = buildApp({
        config: loadConfig(validEnv({ ATLASSIAN_AUTH_MODE: mode })),
        roles: new Map([['tester', makeRole()]]),
        ask: vi.fn(),
        answers: createAnswerMemory(),
        saveFeedback: vi.fn(),
        staticFiles: new Map(),
        logger: createLogger({ destination: createMemoryStream().stream }),
      });

      const response = await app.inject({
        method: 'GET',
        url: STATUS,
        headers: { host: OWN_HOST },
      });

      expect(response.json()).toEqual({ mode, signedIn: true });
    },
  );
});

describe('the sign-in routes outside oauth mode', () => {
  it.each([
    ['GET', START],
    ['GET', CALLBACK],
    ['POST', LOGOUT],
  ])('%s %s is not found', async (method, url) => {
    const app = buildApp({
      config: loadConfig(validEnv({ ATLASSIAN_AUTH_MODE: 'bearer' })),
      roles: new Map([['tester', makeRole()]]),
      ask: vi.fn(),
      answers: createAnswerMemory(),
      saveFeedback: vi.fn(),
      staticFiles: new Map(),
      logger: createLogger({ destination: createMemoryStream().stream }),
    });

    const response = await app.inject({
      method: /** @type {'GET' | 'POST'} */ (method),
      url,
      headers: JSON_HEADERS,
      ...(method === 'POST' ? { payload: {} } : {}),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/auth/atlassian/logout', () => {
  it('signs out, ends the open conversation, and says whether the tokens were revoked', async () => {
    const { app, signOut, endActiveConversation } = oauthApp();

    const response = await app.inject({
      method: 'POST',
      url: LOGOUT,
      headers: JSON_HEADERS,
      payload: {},
    });

    expect(response.json()).toEqual({ signedOut: true, revoked: true });
    expect(signOut).toHaveBeenCalledOnce();
    expect(endActiveConversation).toHaveBeenCalledOnce();
  });

  it('uses the usual API guards: a form post from another site is refused', async () => {
    const { app, signOut } = oauthApp();

    const response = await app.inject({
      method: 'POST',
      url: LOGOUT,
      headers: {
        host: OWN_HOST,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example',
      },
      payload: 'a=1',
    });

    expect(response.statusCode).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('refuses a body with anything in it', async () => {
    const { app, signOut } = oauthApp();

    const response = await app.inject({
      method: 'POST',
      url: LOGOUT,
      headers: JSON_HEADERS,
      payload: { everything: true },
    });

    expect(response.statusCode).toBe(400);
    expect(signOut).not.toHaveBeenCalled();
  });
});
