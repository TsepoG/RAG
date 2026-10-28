// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createPendingSignIns } from '../../src/atlassian/pending.js';
import { createSignInFlow } from '../../src/atlassian/signIn.js';
import { createLogger } from '../../src/logger/index.js';
import {
  CLIENT,
  fakeFetch,
  formOf,
  json,
  KNOWN_DISCOVERY,
  memoryStore,
  SERVER,
  tokenAnswer,
} from '../helpers/atlassian.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const CLOUD_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SITE_URL = 'https://acme.atlassian.net';
const NOW = 5_000_000;

/** The site check's answer when the account can reach the site. */
const REACHABLE = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({ data: { resources: [{ cloudId: CLOUD_ID, url: SITE_URL }] } }),
    },
  ],
};

/**
 * A flow over fakes. The token endpoint answers with `tokens`; the registration endpoint with a
 * new client; the MCP site check with `sites`.
 * @param {object} [options] - What to change.
 * @param {(request: import('../helpers/atlassian.js').SeenRequest) => Response} [options.tokens] - The token endpoint.
 * @param {unknown} [options.sites] - The site check's answer.
 * @param {boolean} [options.registered] - Whether there is a stored registration.
 * @param {import('../../src/atlassian/index.js').Discovery} [options.discovery] - The discovery.
 * @returns {{ flow: ReturnType<typeof createSignInFlow>, store: ReturnType<typeof memoryStore>, requests: import('../helpers/atlassian.js').SeenRequest[], connect: import('vitest').Mock, lines: () => Array<Record<string, unknown>> }} The flow and its doubles.
 */
function setup({
  tokens = () => tokenAnswer(1),
  sites = REACHABLE,
  registered = true,
  discovery = KNOWN_DISCOVERY,
} = {}) {
  const store = memoryStore({ client: registered ? CLIENT : undefined, lockPath: 'unused' });
  const { fetch, requests } = fakeFetch((request) =>
    request.url === SERVER.registrationEndpoint
      ? json({ client_id: 'new-client' }, 201)
      : tokens(request),
  );
  const connect = vi.fn(async () => ({
    callTool: async () => sites,
    close: async () => undefined,
  }));
  const { stream, lines } = createMemoryStream();
  const flow = createSignInFlow({
    settings: {
      cloudId: CLOUD_ID,
      siteUrl: SITE_URL,
      redirectUri: CLIENT.redirectUri,
      mcpTimeoutMs: 30_000,
    },
    discovery,
    store,
    pending: createPendingSignIns({ clock: { now: () => NOW } }),
    fetch,
    clock: { now: () => NOW },
    connect: /** @type {Parameters<typeof createSignInFlow>[0]['connect']} */ (
      /** @type {unknown} */ (connect)
    ),
    logger: createLogger({ destination: stream }),
  });
  return { flow, store, requests, connect, lines };
}

/**
 * Starts a sign-in and returns its state, read back from the authorize URL, and its nonce.
 * @param {ReturnType<typeof createSignInFlow>} flow - The flow.
 * @returns {Promise<{ state: string, nonce: string, url: URL }>} The state, nonce and URL.
 */
async function started(flow) {
  const { authorizeUrl, nonce } = await flow.start();
  const url = new URL(authorizeUrl);
  return { state: url.searchParams.get('state') ?? '', nonce, url };
}

const CODE = 'fake-authorization-code';

describe('createSignInFlow start', () => {
  it('builds the authorize URL for the stored registration', async () => {
    const { flow, requests } = setup();

    const { url, nonce } = await started(flow);

    expect(`${url.origin}${url.pathname}`).toBe(SERVER.authorizationEndpoint);
    expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri);
    expect(nonce).toMatch(/^[\w-]{43}$/);
    expect(requests).toEqual([]);
  });

  it('registers first when there is no registration', async () => {
    const { flow, store } = setup({ registered: false });

    const { url } = await started(flow);

    expect(url.searchParams.get('client_id')).toBe('new-client');
    expect(store.state.client?.clientId).toBe('new-client');
  });
});

describe('createSignInFlow finish', () => {
  it('exchanges the code, checks the site and saves the sign-in', async () => {
    const { flow, store, requests } = setup();
    const { state, nonce } = await started(flow);

    const outcome = await flow.finish({ query: { code: CODE, state }, nonce });

    expect(outcome).toEqual({ ok: true });
    expect(formOf(requests[0])).toMatchObject({ grant_type: 'authorization_code', code: CODE });
    expect(store.state.signIn).toEqual({
      accessToken: 'fake-access-token-1',
      refreshToken: 'fake-refresh-token-1',
      expiresAt: NOW + 28_800_000,
      scopes: [
        'offline_access',
        'read:confluence:agent-interface',
        'search:confluence:agent-interface',
      ],
      cloudId: CLOUD_ID,
      siteHost: 'acme.atlassian.net',
    });
  });

  it('logs the outcome without the code, the state, the nonce or a token', async () => {
    const { flow, lines } = setup();
    const { state, nonce } = await started(flow);

    await flow.finish({ query: { code: CODE, state }, nonce });

    const output = JSON.stringify(lines());
    for (const secret of [CODE, state, nonce, 'fake-access-token', 'fake-refresh-token']) {
      expect(output).not.toContain(secret);
    }
  });

  it('refuses a callback whose query is not usable', async () => {
    const { flow } = setup();
    await started(flow);

    expect(await flow.finish({ query: { code: CODE }, nonce: undefined })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('says the person cancelled when Atlassian sends access_denied', async () => {
    const { flow } = setup();

    expect(await flow.finish({ query: { error: 'access_denied' }, nonce: undefined })).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  it('forgets the registration when Atlassian no longer knows the client', async () => {
    const { flow, store } = setup();

    await flow.finish({ query: { error: 'unauthorized_client' }, nonce: undefined });

    expect(store.state.client).toBeUndefined();
  });

  it('refuses a state it did not start as expired', async () => {
    const { flow } = setup();
    const { state, nonce } = await started(flow);

    expect(
      await flow.finish({ query: { code: CODE, state: `${state.slice(0, -1)}x` }, nonce }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a state that was already used as expired', async () => {
    const { flow } = setup();
    const { state, nonce } = await started(flow);
    await flow.finish({ query: { code: CODE, state }, nonce });

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a callback without the cookie of the browser that started it', async () => {
    const { flow, store } = setup();
    const { state } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce: undefined })).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(store.state.signIn).toBeUndefined();
  });

  it('refuses a callback with another browser cookie', async () => {
    const { flow } = setup();
    const { state } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce: 'n'.repeat(43) })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('fails when the registration changed since the sign-in started', async () => {
    const { flow, store } = setup();
    const { state, nonce } = await started(flow);
    store.state.client = undefined;

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('says a code Atlassian refuses as used has expired', async () => {
    const { flow } = setup({ tokens: () => json({ error: 'invalid_grant' }, 400) });
    const { state, nonce } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('forgets the registration when the token endpoint no longer knows the client', async () => {
    const { flow, store } = setup({ tokens: () => json({ error: 'invalid_client' }, 401) });
    const { state, nonce } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(store.state.client).toBeUndefined();
  });

  it.each([
    [
      'without a Confluence scope',
      () => tokenAnswer(1, { scope: 'offline_access read:confluence:agent-interface' }),
    ],
    ['without a refresh token', () => tokenAnswer(1, { refresh_token: undefined })],
  ])('does not save a sign-in %s', async (_label, tokens) => {
    const { flow, store, connect } = setup({ tokens });
    const { state, nonce } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'missing-permissions',
    });
    expect(store.state.signIn).toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not save a sign-in to an account that cannot reach the site', async () => {
    const other = {
      content: [{ type: 'text', text: JSON.stringify({ data: { resources: [] } }) }],
    };
    const { flow, store } = setup({ sites: other });
    const { state, nonce } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'wrong-site',
    });
    expect(store.state.signIn).toBeUndefined();
  });

  it('turns a failure to reach Atlassian into "failed", logging only its message', async () => {
    const { flow, lines } = setup({
      tokens: () => {
        throw new TypeError('fetch failed');
      },
    });
    const { state, nonce } = await started(flow);

    expect(await flow.finish({ query: { code: CODE, state }, nonce })).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(lines()).toContainEqual(
      expect.objectContaining({ detail: 'Could not reach Atlassian to finish signing in' }),
    );
  });

  it('turns an unexpected failure into "failed", logging it as an error', async () => {
    const { flow, lines } = setup({
      discovery: {
        authorizationServer: async () => {
          throw new Error('bug');
        },
      },
    });

    expect(await flow.finish({ query: {}, nonce: undefined })).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(lines()).toContainEqual(expect.objectContaining({ level: 'error' }));
  });
});
