// @ts-check
import { describe, expect, it } from 'vitest';
import {
  CALLBACK_PATH,
  CLIENT_NAME,
  ensureClient,
  redirectUriFor,
} from '../../src/atlassian/client.js';
import { AtlassianAuthError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { CLIENT, fakeFetch, json, memoryStore, SERVER } from '../helpers/atlassian.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const REDIRECT = 'http://127.0.0.1:3000/auth/atlassian/callback';

/**
 * Runs ensureClient against a store and an answer.
 * @param {{ client?: import('../../src/atlassian/index.js').StoredClient, answer?: () => Response, redirectUri?: string }} [options] - What there is.
 * @returns {{ run: () => ReturnType<typeof ensureClient>, store: ReturnType<typeof memoryStore>, requests: import('../helpers/atlassian.js').SeenRequest[] }} The run and its doubles.
 */
function setup({
  client,
  answer = () => json({ client_id: 'new-client' }, 201),
  redirectUri = REDIRECT,
} = {}) {
  const store = memoryStore({ client, lockPath: 'unused' });
  const { fetch, requests } = fakeFetch(answer);
  const { stream } = createMemoryStream();
  const run = () =>
    ensureClient({
      store,
      server: SERVER,
      redirectUri,
      fetch,
      logger: createLogger({ destination: stream }),
    });
  return { run, store, requests };
}

describe('redirectUriFor', () => {
  it('comes back to 127.0.0.1 on the app port', () => {
    expect(redirectUriFor(3000)).toBe(REDIRECT);
    expect(CALLBACK_PATH).toBe('/auth/atlassian/callback');
  });
});

describe('ensureClient', () => {
  it('reuses the stored registration without asking Atlassian', async () => {
    const { run, requests } = setup({ client: CLIENT });

    expect(await run()).toEqual(CLIENT);
    expect(requests).toEqual([]);
  });

  it('registers once as a public client and keeps the registration', async () => {
    const { run, store, requests } = setup();

    const client = await run();

    expect(client).toEqual({
      issuer: SERVER.issuer,
      clientId: 'new-client',
      redirectUri: REDIRECT,
    });
    expect(store.state.client).toEqual(client);
    expect(requests[0].url).toBe(SERVER.registrationEndpoint);
    expect(JSON.parse(requests[0].body ?? '')).toEqual({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('registers again when the port, and so the redirect, changed', async () => {
    const { run, requests } = setup({
      client: CLIENT,
      redirectUri: 'http://127.0.0.1:4000/auth/atlassian/callback',
    });

    const client = await run();

    expect(requests).toHaveLength(1);
    expect(client.redirectUri).toBe('http://127.0.0.1:4000/auth/atlassian/callback');
  });

  it('registers again for another authorization server', async () => {
    const { run, requests } = setup({ client: { ...CLIENT, issuer: 'https://auth.example/old' } });

    await run();

    expect(requests).toHaveLength(1);
  });

  it('fails clearly, saving nothing, when Atlassian refuses', async () => {
    const { run, store } = setup({
      answer: () => json({ error: 'invalid_redirect_uri', error_description: 'fake detail' }, 400),
    });

    const failure = run();

    await expect(failure).rejects.toThrow(AtlassianAuthError);
    await expect(failure).rejects.toThrow(
      'Could not register the assistant with Atlassian (HTTP 400, invalid_redirect_uri)',
    );
    expect(store.events).toEqual([]);
  });

  it('fails when Atlassian answers without a client id', async () => {
    const { run } = setup({ answer: () => json({}, 201) });

    await expect(run()).rejects.toThrow('(HTTP 201)');
  });
});
