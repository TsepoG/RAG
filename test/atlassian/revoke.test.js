// @ts-check
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signOut } from '../../src/atlassian/revoke.js';
import { createLogger } from '../../src/logger/index.js';
import {
  CLIENT,
  fakeFetch,
  formOf,
  json,
  KNOWN_DISCOVERY,
  memoryStore,
  SERVER,
  SIGN_IN,
} from '../helpers/atlassian.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

/** @type {string} */
let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sign-in-revoke-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Signs out of a store holding a sign-in.
 * @param {object} [options] - What to set up.
 * @param {(request: import('../helpers/atlassian.js').SeenRequest) => Response} [options.answer] - The revocation endpoint.
 * @param {boolean} [options.signedIn] - Whether there is a sign-in.
 * @param {boolean} [options.registered] - Whether there is a registration.
 * @param {import('../../src/atlassian/index.js').Discovery} [options.discovery] - The discovery.
 * @returns {{ run: () => ReturnType<typeof signOut>, store: ReturnType<typeof memoryStore>, requests: import('../helpers/atlassian.js').SeenRequest[], lines: () => Array<Record<string, unknown>> }} The run and its doubles.
 */
function setup({
  answer = () => new Response(null, { status: 200 }),
  signedIn = true,
  registered = true,
  discovery = KNOWN_DISCOVERY,
} = {}) {
  const store = memoryStore({
    signIn: signedIn ? SIGN_IN : undefined,
    client: registered ? CLIENT : undefined,
    lockPath: join(dir, 'atlassian-oauth.lock'),
  });
  const { fetch, requests } = fakeFetch(answer);
  const { stream, lines } = createMemoryStream();
  const run = () =>
    signOut({
      store,
      discovery,
      fetch,
      clock: { now: () => Date.now() },
      logger: createLogger({ destination: stream }),
      lock: { retryMs: 5, waitMs: 30 },
    });
  return { run, store, requests, lines };
}

describe('signOut', () => {
  it('revokes the refresh token, then the access token, then deletes the sign-in', async () => {
    const { run, store, requests } = setup();

    expect(await run()).toEqual({ revoked: true });

    expect(requests.map((request) => [request.url, formOf(request)])).toEqual([
      [
        SERVER.revocationEndpoint,
        {
          token: SIGN_IN.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: CLIENT.clientId,
        },
      ],
      [
        SERVER.revocationEndpoint,
        { token: SIGN_IN.accessToken, token_type_hint: 'access_token', client_id: CLIENT.clientId },
      ],
    ]);
    expect(store.state.signIn).toBeUndefined();
  });

  it('keeps the registration for the next sign-in', async () => {
    const { run, store } = setup();

    await run();

    expect(store.state.client).toEqual(CLIENT);
  });

  it('still deletes the sign-in when Atlassian refuses, says so, and logs no token', async () => {
    const { run, store, lines } = setup({
      answer: () =>
        json({ error: 'unsupported_token_type', error_description: 'fake-detail' }, 400),
    });

    expect(await run()).toEqual({ revoked: false });
    expect(store.state.signIn).toBeUndefined();
    expect(lines()[0]).toMatchObject({ status: 400, error: 'unsupported_token_type' });
    expect(JSON.stringify(lines())).not.toContain('fake-');
  });

  it('still deletes the sign-in when Atlassian cannot be reached', async () => {
    const { run, store } = setup({
      answer: () => {
        throw new TypeError('fetch failed');
      },
    });

    expect(await run()).toEqual({ revoked: false });
    expect(store.state.signIn).toBeUndefined();
  });

  it('reports one refused token as not revoked', async () => {
    let calls = 0;
    const { run } = setup({
      answer: () => {
        calls += 1;
        return new Response(null, { status: calls === 1 ? 200 : 503 });
      },
    });

    expect(await run()).toEqual({ revoked: false });
  });

  it('still deletes the sign-in when there is no registration to revoke with', async () => {
    const { run, store, requests } = setup({ registered: false });

    expect(await run()).toEqual({ revoked: false });
    expect(requests).toEqual([]);
    expect(store.state.signIn).toBeUndefined();
  });

  it('still deletes the sign-in when the revocation endpoint cannot be found', async () => {
    const { run, store } = setup({
      discovery: {
        authorizationServer: async () => {
          throw new Error('metadata down');
        },
      },
    });

    expect(await run()).toEqual({ revoked: false });
    expect(store.state.signIn).toBeUndefined();
  });

  it('has nothing to revoke when nobody is signed in', async () => {
    const { run, requests } = setup({ signedIn: false });

    expect(await run()).toEqual({ revoked: true });
    expect(requests).toEqual([]);
  });

  it('still deletes the sign-in when a renewal holds the lock for too long', async () => {
    const { run, store, requests } = setup();
    await fs.writeFile(store.lockPath, '');

    expect(await run()).toEqual({ revoked: false });
    expect(requests).toEqual([]);
    expect(store.state.signIn).toBeUndefined();
  });

  it('revokes the tokens a renewal saved while it waited for the lock', async () => {
    const { run, store, requests } = setup();
    const original = store.readSignIn;
    let reads = 0;
    store.readSignIn = async () => {
      reads += 1;
      return reads === 1 ? original() : { ...SIGN_IN, refreshToken: 'fake-refresh-newer' };
    };

    await run();

    expect(formOf(requests[0]).token).toBe('fake-refresh-newer');
  });
});

describe('signOut when the sign-in vanishes while it waits', () => {
  it('revokes the tokens it read first', async () => {
    const { run, store, requests } = setup();
    const original = store.readSignIn;
    let reads = 0;
    store.readSignIn = async () => {
      reads += 1;
      return reads === 1 ? original() : undefined;
    };

    await run();

    expect(formOf(requests[0]).token).toBe(SIGN_IN.refreshToken);
  });
});
