// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGithubApi, describeFailure } from '../../src/github/api.js';
import { FAKE_GITHUB_TOKEN } from '../helpers/env.js';

/**
 * Builds a client around a fake fetch that answers every request with one response.
 * @param {() => Response | Promise<Response>} answer - Makes the response.
 * @returns {{ api: ReturnType<typeof createGithubApi>, fetchFunction: ReturnType<typeof vi.fn> }} The
 *   client and the fake.
 */
function setup(answer) {
  const fetchFunction = vi.fn(async () => answer());
  const api = createGithubApi({
    token: FAKE_GITHUB_TOKEN,
    fetch: /** @type {typeof fetch} */ (fetchFunction),
  });
  return { api, fetchFunction };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createGithubApi getJson', () => {
  it('reads a JSON object from the API root', async () => {
    const { api, fetchFunction } = setup(() => new Response('{"default_branch":"main"}'));

    expect(await api.getJson('/repos/acme/app')).toEqual({ default_branch: 'main' });
    expect(fetchFunction.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/app');
  });

  it('gives an empty object for JSON that is not an object', async () => {
    const { api } = setup(() => new Response('null'));

    expect(await api.getJson('/x')).toEqual({});
  });

  it.each([401, 403, 404, 500])('throws with the status when GitHub answers %i', async (status) => {
    const { api } = setup(() => new Response('{}', { status }));

    await expect(api.getJson('/x')).rejects.toThrow(`GitHub answered ${status}`);
  });

  it('asks for JSON in the headers GitHub expects', async () => {
    const { api, fetchFunction } = setup(() => new Response('{}'));

    await api.getJson('/x');

    expect(fetchFunction.mock.calls[0][1].headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'role-aware-assistant',
    });
  });
});

describe('createGithubApi getRaw', () => {
  it('reads the text of a file', async () => {
    const { api, fetchFunction } = setup(() => new Response('* @acme/team\n'));

    expect(await api.getRaw('/repos/acme/app/contents/CODEOWNERS')).toBe('* @acme/team\n');
    expect(fetchFunction.mock.calls[0][1].headers.Accept).toBe('application/vnd.github.raw+json');
  });

  it('gives undefined when the file is not there', async () => {
    const { api } = setup(() => new Response('{}', { status: 404 }));

    expect(await api.getRaw('/x')).toBeUndefined();
  });

  it.each([403, 500])('throws with the status when GitHub answers %i', async (status) => {
    const { api } = setup(() => new Response('', { status }));

    await expect(api.getRaw('/x')).rejects.toThrow(`GitHub answered ${status}`);
  });
});

describe('createGithubApi requests', () => {
  it('sends the token only in the Authorization header', async () => {
    const { api, fetchFunction } = setup(() => new Response('{}'));

    await api.getJson('/x');
    await api.getRaw('/y');

    for (const [url, init] of fetchFunction.mock.calls) {
      expect(url).not.toContain(FAKE_GITHUB_TOKEN);
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_GITHUB_TOKEN}`);
      const others = Object.entries(init.headers).filter(([name]) => name !== 'Authorization');
      expect(JSON.stringify(others)).not.toContain(FAKE_GITHUB_TOKEN);
    }
  });

  it('only reads: every request is a GET with a time limit and no body', async () => {
    const { api, fetchFunction } = setup(() => new Response('{}'));

    await api.getJson('/x');
    await api.getRaw('/y');

    for (const [, init] of fetchFunction.mock.calls) {
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('uses the global fetch when none is given', async () => {
    const globalFetch = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', globalFetch);

    expect(await createGithubApi({ token: FAKE_GITHUB_TOKEN }).getJson('/x')).toEqual({ ok: true });
    expect(globalFetch).toHaveBeenCalledOnce();
  });
});

describe('describeFailure', () => {
  it('gives the message of our own errors', () => {
    expect(describeFailure(new Error('GitHub answered 500'))).toBe('GitHub answered 500');
  });

  it('names only the type of any other error', () => {
    expect(describeFailure(new TypeError('secret detail'))).toBe('TypeError');
  });

  it('copes with something that is not an error', () => {
    expect(describeFailure('text')).toBe('unknown');
  });
});
