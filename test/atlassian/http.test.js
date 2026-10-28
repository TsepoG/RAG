// @ts-check
import { describe, expect, it } from 'vitest';
import {
  describeFailure,
  getJson,
  oauthErrorOf,
  postForm,
  postJson,
  REQUEST_TIMEOUT_MS,
  send,
} from '../../src/atlassian/http.js';
import { AtlassianAuthError } from '../../src/errors/index.js';
import { fakeFetch, json } from '../helpers/atlassian.js';

const URL_ = 'https://auth.atlassian.com/oauth/token';

describe('send', () => {
  it('asks for JSON with a time limit and reads the body', async () => {
    const { fetch, requests } = fakeFetch(() => json({ a: 1 }, 201));

    const result = await send(fetch, URL_, { method: 'GET' }, 'look');

    expect(result).toEqual({ ok: true, status: 201, body: { a: 1 } });
    expect(requests[0].headers).toEqual({ Accept: 'application/json' });
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('gives an undefined body when the answer is not JSON', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>oops</html>', { status: 502 }));

    expect(await send(fetch, URL_, { method: 'GET' }, 'look')).toEqual({
      ok: false,
      status: 502,
      body: undefined,
    });
  });

  it('says Atlassian could not be reached, keeping the reason as the cause', async () => {
    const reason = new TypeError('fetch failed');
    const { fetch } = fakeFetch(() => {
      throw reason;
    });

    const failure = send(fetch, URL_, { method: 'GET' }, 'renew the sign-in');

    await expect(failure).rejects.toThrow(AtlassianAuthError);
    await expect(failure).rejects.toMatchObject({
      message: 'Could not reach Atlassian to renew the sign-in',
      cause: reason,
    });
  });
});

describe('getJson', () => {
  it('returns the body of a 2xx answer', async () => {
    const { fetch } = fakeFetch(() => json({ issuer: 'x' }));

    expect(await getJson(fetch, URL_, 'read the metadata')).toEqual({ issuer: 'x' });
  });

  it('describes a refusal by status only, never by its body', async () => {
    const { fetch } = fakeFetch(() => json({ detail: 'fake-secret-in-body' }, 404));

    const failure = getJson(fetch, URL_, 'read the metadata');

    await expect(failure).rejects.toThrow('Could not read the metadata (HTTP 404)');
    await expect(failure).rejects.not.toThrow('fake-secret');
  });
});

describe('postForm and postJson', () => {
  it('sends a form', async () => {
    const { fetch, requests } = fakeFetch(() => json({}));

    await postForm(fetch, URL_, { grant_type: 'refresh_token', a: 'b c' }, 'renew');

    expect(requests[0]).toMatchObject({
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&a=b+c',
    });
  });

  it('sends JSON', async () => {
    const { fetch, requests } = fakeFetch(() => json({}));

    await postJson(fetch, URL_, { client_name: 'x' }, 'register');

    expect(requests[0]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"client_name":"x"}',
    });
  });
});

describe('oauthErrorOf', () => {
  it('reads an OAuth error code', () => {
    expect(oauthErrorOf({ error: 'invalid_grant', error_description: 'fake-secret' })).toBe(
      'invalid_grant',
    );
  });

  it.each([
    ['not an object', 'invalid_grant'],
    ['null', null],
    ['no error', {}],
    ['an error that is not a code', { error: 'Bearer fake-token' }],
    ['an error that is not a string', { error: 42 }],
  ])('gives nothing for %s', (_label, body) => {
    expect(oauthErrorOf(body)).toBeUndefined();
  });
});

describe('describeFailure', () => {
  it('names the status and the error code', () => {
    expect(describeFailure('renew', { status: 400, body: { error: 'invalid_grant' } })).toBe(
      'Could not renew (HTTP 400, invalid_grant)',
    );
  });

  it('names the status alone when there is no code', () => {
    expect(describeFailure('renew', { status: 500, body: undefined })).toBe(
      'Could not renew (HTTP 500)',
    );
  });
});
