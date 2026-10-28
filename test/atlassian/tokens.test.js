// @ts-check
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STALE_LOCK_MS } from '../../src/atlassian/lock.js';
import { createSignInStore } from '../../src/atlassian/store.js';
import { createTokenProvider } from '../../src/atlassian/tokens.js';
import { AtlassianAuthError, AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import {
  CLIENT,
  fakeFetch,
  formOf,
  json,
  KNOWN_DISCOVERY,
  memoryStore,
  SIGN_IN,
  tokenAnswer,
} from '../helpers/atlassian.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FIVE_MINUTES = 5 * MINUTE;

/** Quick lock timings, so a test that waits does not wait long. */
const QUICK_LOCK = Object.freeze({ retryMs: 5, waitMs: 2000 });

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sign-in-tokens-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * A provider over an in-memory store whose token runs out in `left` ms.
 * @param {object} [options] - What to set up.
 * @param {number} [options.left] - How long the stored access token has left.
 * @param {(request: import('../helpers/atlassian.js').SeenRequest) => Response | Promise<Response>} [options.answer] - The token endpoint.
 * @param {boolean} [options.signedIn] - Whether there is a sign-in.
 * @param {boolean} [options.registered] - Whether there is a registration.
 * @returns {{ provider: ReturnType<typeof createTokenProvider>, store: ReturnType<typeof memoryStore>, requests: import('../helpers/atlassian.js').SeenRequest[], lines: () => Array<Record<string, unknown>>, now: number }} The provider and its doubles.
 */
function setup({
  left = 6 * HOUR,
  answer = () => tokenAnswer(2),
  signedIn = true,
  registered = true,
} = {}) {
  const now = 50_000_000;
  const store = memoryStore({
    signIn: signedIn ? { ...SIGN_IN, expiresAt: now + left } : undefined,
    client: registered ? CLIENT : undefined,
    lockPath: join(dir, 'atlassian-oauth.lock'),
  });
  const { fetch, requests } = fakeFetch(answer);
  const { stream, lines } = createMemoryStream();
  const provider = createTokenProvider({
    store,
    discovery: KNOWN_DISCOVERY,
    fetch,
    clock: { now: () => now },
    logger: createLogger({ destination: stream }),
    lock: QUICK_LOCK,
  });
  return { provider, store, requests, lines, now };
}

/**
 * Asks for a token and returns the error it fails with.
 * @param {ReturnType<typeof createTokenProvider>} provider - The provider.
 * @param {number} minValidityMs - The margin.
 * @returns {Promise<Error>} The error.
 */
async function failureOf(provider, minValidityMs) {
  try {
    await provider.getAtlassianToken({ minValidityMs });
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('expected the token to be refused');
}

describe('getAtlassianToken with time to spare', () => {
  it('hands out the stored token without asking Atlassian', async () => {
    const { provider, requests, now } = setup({ left: 4 * HOUR });

    const token = await provider.getAtlassianToken({ minValidityMs: 3 * HOUR });

    expect(token).toEqual({ accessToken: 'fake-access-token-1', expiresAt: now + 4 * HOUR });
    expect(requests).toEqual([]);
  });

  it('refuses when nobody is signed in', async () => {
    const { provider } = setup({ signedIn: false });

    expect(await failureOf(provider, FIVE_MINUTES)).toBeInstanceOf(AtlassianSignInRequiredError);
  });
});

describe('getAtlassianToken below the margin', () => {
  it('renews with the refresh token and hands out the new token', async () => {
    const { provider, requests, now } = setup({ left: 2 * HOUR });

    const token = await provider.getAtlassianToken({ minValidityMs: 3 * HOUR });

    expect(token).toEqual({ accessToken: 'fake-access-token-2', expiresAt: now + 28_800_000 });
    expect(formOf(requests[0])).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'fake-refresh-token-1',
      client_id: CLIENT.clientId,
    });
  });

  it('saves the rotated tokens before handing out the new one', async () => {
    const { provider, store } = setup({ left: MINUTE });

    await provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES });

    expect(store.events).toEqual(['writeSignIn']);
    expect(store.state.signIn).toMatchObject({
      accessToken: 'fake-access-token-2',
      refreshToken: 'fake-refresh-token-2',
      cloudId: SIGN_IN.cloudId,
      siteHost: SIGN_IN.siteHost,
    });
  });

  it('keeps the old refresh token when Atlassian sends no new one', async () => {
    const { provider, store } = setup({
      left: MINUTE,
      answer: () => tokenAnswer(2, { refresh_token: undefined }),
    });

    await provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES });

    expect(store.state.signIn?.refreshToken).toBe('fake-refresh-token-1');
  });

  it('renews only once for callers who ask at the same time', async () => {
    const { provider, requests } = setup({ left: MINUTE });

    const tokens = await Promise.all([
      provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES }),
      provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES }),
      provider.getAtlassianToken({ minValidityMs: 3 * HOUR }),
    ]);

    expect(requests).toHaveLength(1);
    expect(new Set(tokens.map(({ accessToken }) => accessToken))).toEqual(
      new Set(['fake-access-token-2']),
    );
  });

  it('logs the renewal without any token', async () => {
    const { provider, lines } = setup({ left: MINUTE });

    await provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES });

    expect(lines()).toEqual([expect.objectContaining({ msg: 'renewed the Atlassian sign-in' })]);
    expect(JSON.stringify(lines())).not.toContain('fake-');
  });

  it('uses the sign-in another process renewed while it waited for the lock', async () => {
    const { provider, store, requests, now } = setup({ left: MINUTE });
    const original = store.readSignIn;
    let reads = 0;
    store.readSignIn = async () => {
      reads += 1;
      // The first read is before the lock; by the second, another process has renewed.
      return reads === 1
        ? original()
        : { ...SIGN_IN, accessToken: 'fake-other', expiresAt: now + 8 * HOUR };
    };

    const token = await provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES });

    expect(token.accessToken).toBe('fake-other');
    expect(requests).toEqual([]);
  });

  it('refuses when the registration is missing', async () => {
    const { provider } = setup({ left: MINUTE, registered: false });

    expect(await failureOf(provider, FIVE_MINUTES)).toBeInstanceOf(AtlassianSignInRequiredError);
  });
});

describe('getAtlassianToken when the refresh token is refused', () => {
  it('signs the person out after reading the file once more, keeping the registration', async () => {
    const { provider, store } = setup({
      left: MINUTE,
      answer: () => json({ error: 'invalid_grant' }, 400),
    });

    const error = await failureOf(provider, FIVE_MINUTES);

    expect(error).toBeInstanceOf(AtlassianSignInRequiredError);
    expect(/** @type {Error} */ (error.cause).message).toBe(
      'Could not renew the Atlassian sign-in (HTTP 400, invalid_grant)',
    );
    expect(store.state.signIn).toBeUndefined();
    expect(store.state.client).toEqual(CLIENT);
  });

  it('uses the tokens another process rotated in the meantime', async () => {
    const context = setup({ left: MINUTE });
    const { provider, store, now } = context;
    const rotated = {
      ...SIGN_IN,
      accessToken: 'fake-rotated',
      refreshToken: 'fake-refresh-rotated',
      expiresAt: now + 8 * HOUR,
    };
    const { fetch } = fakeFetch(async () => {
      // Another process renewed with the same refresh token a moment earlier.
      store.state.signIn = rotated;
      return json({ error: 'invalid_grant' }, 400);
    });
    const racing = createTokenProvider({
      store,
      discovery: KNOWN_DISCOVERY,
      fetch,
      clock: { now: () => now },
      logger: createLogger({ destination: createMemoryStream().stream }),
      lock: QUICK_LOCK,
    });

    const token = await racing.getAtlassianToken({ minValidityMs: FIVE_MINUTES });

    expect(token.accessToken).toBe('fake-rotated');
    expect(store.state.signIn).toEqual(rotated);
    expect(provider).toBeDefined();
  });

  it('forgets the registration too when Atlassian no longer knows the client', async () => {
    const { provider, store } = setup({
      left: MINUTE,
      answer: () => json({ error: 'invalid_client' }, 401),
    });

    expect(await failureOf(provider, FIVE_MINUTES)).toBeInstanceOf(AtlassianSignInRequiredError);
    expect(store.state.signIn).toBeUndefined();
    expect(store.state.client).toBeUndefined();
  });

  it('keeps the sign-in when Atlassian fails for another reason, so a later attempt can renew', async () => {
    const { provider, store, lines } = setup({ left: MINUTE, answer: () => json({}, 503) });

    const error = await failureOf(provider, FIVE_MINUTES);

    expect(error).toBeInstanceOf(AtlassianSignInRequiredError);
    expect(store.state.signIn).toBeDefined();
    expect(lines()[0]).toMatchObject({ level: 'warn', status: 503 });
  });

  it('reports a network failure as a sign-in to make again, with the reason as its cause', async () => {
    const { provider, store } = setup({
      left: MINUTE,
      answer: () => {
        throw new TypeError('fetch failed');
      },
    });

    const error = await failureOf(provider, FIVE_MINUTES);

    expect(error).toBeInstanceOf(AtlassianSignInRequiredError);
    expect(error.cause).toBeInstanceOf(AtlassianAuthError);
    expect(store.state.signIn).toBeDefined();
  });

  it('can renew again after a failed renewal', async () => {
    let fail = true;
    const { provider } = setup({
      left: MINUTE,
      answer: () => (fail ? json({}, 503) : tokenAnswer(3)),
    });
    await failureOf(provider, FIVE_MINUTES);
    fail = false;

    const token = await provider.getAtlassianToken({ minValidityMs: FIVE_MINUTES });

    expect(token.accessToken).toBe('fake-access-token-3');
  });
});

describe('getAtlassianToken across processes', () => {
  /**
   * A provider over the real store in the test folder, as one process would have.
   * @param {{ fetch: typeof fetch, now: number }} options - Its fetch and its clock.
   * @returns {ReturnType<typeof createTokenProvider>} The provider.
   */
  function processProvider({ fetch, now }) {
    const { stream } = createMemoryStream();
    const logger = createLogger({ destination: stream });
    return createTokenProvider({
      store: createSignInStore({ dir, logger }),
      discovery: KNOWN_DISCOVERY,
      fetch,
      clock: { now: () => now },
      logger,
      lock: QUICK_LOCK,
    });
  }

  it('renews once when two processes sharing the folder need a token at the same moment', async () => {
    const now = Date.now();
    const store = createSignInStore({
      dir,
      logger: createLogger({ destination: createMemoryStream().stream }),
    });
    await store.writeClient(CLIENT);
    await store.writeSignIn({ ...SIGN_IN, expiresAt: now + MINUTE });
    let renewals = 0;
    const { fetch } = fakeFetch(async () => {
      renewals += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return tokenAnswer(renewals + 1);
    });

    const [first, second] = await Promise.all([
      processProvider({ fetch, now }).getAtlassianToken({ minValidityMs: FIVE_MINUTES }),
      processProvider({ fetch, now }).getAtlassianToken({ minValidityMs: FIVE_MINUTES }),
    ]);

    expect(renewals).toBe(1);
    expect(first.accessToken).toBe('fake-access-token-2');
    expect(second.accessToken).toBe('fake-access-token-2');
    expect((await store.readSignIn())?.refreshToken).toBe('fake-refresh-token-2');
  });

  it('breaks a lock left behind by a process that died', async () => {
    // Well past the stale age of the lock file written just below.
    const now = Date.now() + 2 * STALE_LOCK_MS;
    const store = createSignInStore({
      dir,
      logger: createLogger({ destination: createMemoryStream().stream }),
    });
    await store.writeClient(CLIENT);
    await store.writeSignIn({ ...SIGN_IN, expiresAt: now + MINUTE });
    await fs.writeFile(store.lockPath, '');
    const { fetch } = fakeFetch(() => tokenAnswer(2));

    const token = await processProvider({ fetch, now }).getAtlassianToken({
      minValidityMs: FIVE_MINUTES,
    });

    expect(token.accessToken).toBe('fake-access-token-2');
  });
});

describe('status', () => {
  it('says nobody is signed in', async () => {
    expect(await setup({ signedIn: false }).provider.status()).toEqual({ signedIn: false });
  });

  it('gives the expiry and the site, never a token, and asks nothing of Atlassian', async () => {
    const { provider, requests, now } = setup({ left: -HOUR });

    const status = await provider.status();

    expect(status).toEqual({
      signedIn: true,
      expiresAt: now - HOUR,
      siteHost: 'acme.atlassian.net',
    });
    expect(JSON.stringify(status)).not.toContain('fake-');
    expect(requests).toEqual([]);
  });
});
