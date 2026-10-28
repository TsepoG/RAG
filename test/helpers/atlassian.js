// @ts-check

// Test doubles for the Atlassian sign-in: a fetch that answers from a table, an in-memory store,
// and the values every test shares. No token here is real.

export const ISSUER = 'https://auth.atlassian.com/tenant-id';

/** @type {import('../../src/atlassian/index.js').AuthorizationServer} */
export const SERVER = Object.freeze({
  issuer: ISSUER,
  authorizationEndpoint: 'https://auth.atlassian.com/authorize',
  tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
  revocationEndpoint: 'https://auth.atlassian.com/oauth/revoke',
  registrationEndpoint: `${ISSUER}/dcr/register`,
  issParameterSupported: false,
});

/** @type {import('../../src/atlassian/index.js').StoredClient} */
export const CLIENT = Object.freeze({
  issuer: ISSUER,
  clientId: 'client-123',
  redirectUri: 'http://127.0.0.1:3000/auth/atlassian/callback',
});

/** @type {import('../../src/atlassian/index.js').StoredSignIn} */
export const SIGN_IN = Object.freeze({
  accessToken: 'fake-access-token-1',
  refreshToken: 'fake-refresh-token-1',
  expiresAt: 10_000_000,
  scopes: [
    'offline_access',
    'read:confluence:agent-interface',
    'search:confluence:agent-interface',
  ],
  cloudId: '0f1e2d3c-4b5a-4968-8776-655443322110',
  siteHost: 'acme.atlassian.net',
});

/** A discovery that knows the server without fetching anything. */
export const KNOWN_DISCOVERY = Object.freeze({ authorizationServer: async () => SERVER });

/**
 * One request the fake fetch saw.
 * @typedef {object} SeenRequest
 * @property {string} url - Where it went.
 * @property {string} method - Its method.
 * @property {Record<string, string>} headers - Its headers.
 * @property {string | undefined} body - Its body.
 * @property {AbortSignal | undefined} signal - Its time limit.
 */

/**
 * A fetch that answers from a function, and remembers every request.
 * @param {(request: SeenRequest) => Response | Promise<Response>} answer - Answers a request.
 * @returns {{ fetch: typeof globalThis.fetch, requests: SeenRequest[] }} The fetch and what it saw.
 */
export function fakeFetch(answer) {
  /** @type {SeenRequest[]} */
  const requests = [];
  /** @type {typeof globalThis.fetch} */
  const fetchFunction = async (input, init = {}) => {
    const request = {
      url: input instanceof Request ? input.url : input.toString(),
      method: init.method ?? 'GET',
      headers: /** @type {Record<string, string>} */ (init.headers ?? {}),
      body: typeof init.body === 'string' ? init.body : undefined,
      signal: init.signal ?? undefined,
    };
    requests.push(request);
    return answer(request);
  };
  return { fetch: fetchFunction, requests };
}

/**
 * A JSON response.
 * @param {unknown} body - The body.
 * @param {number} [status] - The status.
 * @returns {Response} The response.
 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A token endpoint answer.
 * @param {number} n - Which tokens these are, so each renewal gives new ones.
 * @param {Record<string, unknown>} [overrides] - Fields to change.
 * @returns {Response} The response.
 */
export function tokenAnswer(n, overrides = {}) {
  return json({
    access_token: `fake-access-token-${n}`,
    refresh_token: `fake-refresh-token-${n}`,
    token_type: 'Bearer',
    expires_in: 28_800,
    scope: 'offline_access read:confluence:agent-interface search:confluence:agent-interface',
    ...overrides,
  });
}

/**
 * The form fields of a request.
 * @param {SeenRequest} request - The request.
 * @returns {Record<string, string>} Its fields.
 */
export function formOf(request) {
  return Object.fromEntries(new URLSearchParams(request.body ?? ''));
}

/**
 * An in-memory sign-in store that records what it was asked to do.
 * @param {{ signIn?: import('../../src/atlassian/index.js').StoredSignIn, client?: import('../../src/atlassian/index.js').StoredClient, lockPath: string }} initial - What it starts with, and where its lock goes.
 * @returns {import('../../src/atlassian/index.js').SignInStore & { state: { signIn?: import('../../src/atlassian/index.js').StoredSignIn, client?: import('../../src/atlassian/index.js').StoredClient }, events: string[] }} The store.
 */
export function memoryStore({ signIn, client, lockPath }) {
  const state = { signIn, client };
  /** @type {string[]} */
  const events = [];
  return {
    state,
    events,
    lockPath,
    async readSignIn() {
      return state.signIn;
    },
    async writeSignIn(value) {
      events.push('writeSignIn');
      state.signIn = value;
    },
    async deleteSignIn() {
      events.push('deleteSignIn');
      state.signIn = undefined;
    },
    async readClient() {
      return state.client;
    },
    async writeClient(value) {
      events.push('writeClient');
      state.client = value;
    },
    async deleteClient() {
      events.push('deleteClient');
      state.client = undefined;
    },
  };
}
