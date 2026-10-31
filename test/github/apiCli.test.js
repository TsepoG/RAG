// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import { createGithubApi } from '../../src/github/index.js';

const FAKE_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';
const NEW_TOKEN = 'gho_NEWnewNEWnew0123456789abcdefXYZ';

/**
 * A client in gh-cli mode around a fake fetch that answers each request in turn.
 * @param {Array<() => Response>} answers - The responses, in order; the last one repeats.
 * @param {string[]} [tokens] - What getToken gives, in order; the last one repeats.
 * @returns {{ api: import('../../src/github/index.js').GithubApi, fetchFunction: import('vitest').Mock, getToken: import('vitest').Mock, invalidate: import('vitest').Mock }} The client and its fakes.
 */
function setup(answers, tokens = [FAKE_TOKEN]) {
  let request = 0;
  let given = 0;
  const fetchFunction = vi.fn(async () => answers[Math.min(request++, answers.length - 1)]());
  const getToken = vi.fn(async () => tokens[Math.min(given++, tokens.length - 1)]);
  const invalidate = vi.fn();
  const api = createGithubApi({
    getToken,
    invalidate,
    fetch: /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchFunction)),
  });
  return { api, fetchFunction, getToken, invalidate };
}

/** @returns {Response} A success. */
const ok = () => new Response('{"ok":true}');
/** @returns {Response} A refused token. */
const unauthorized = () => new Response('{"message":"Bad credentials"}', { status: 401 });

/**
 * The Authorization header of each request the fake fetch saw.
 * @param {import('vitest').Mock} fetchFunction - The fake.
 * @returns {string[]} The headers.
 */
const authorizations = (fetchFunction) =>
  fetchFunction.mock.calls.map(([, init]) => init.headers.Authorization);

describe('createGithubApi with the GitHub CLI token', () => {
  it('asks for the token for every request', async () => {
    const { api, fetchFunction, getToken } = setup([ok], [FAKE_TOKEN, NEW_TOKEN]);

    await api.getJson('/a');
    await api.getRaw('/b');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(authorizations(fetchFunction)).toEqual([`Bearer ${FAKE_TOKEN}`, `Bearer ${NEW_TOKEN}`]);
  });

  it('after a 401, forgets the token and tries once more with a fresh one', async () => {
    const { api, fetchFunction, invalidate } = setup([unauthorized, ok], [FAKE_TOKEN, NEW_TOKEN]);

    expect(await api.getJson('/a')).toEqual({ ok: true });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(authorizations(fetchFunction)).toEqual([`Bearer ${FAKE_TOKEN}`, `Bearer ${NEW_TOKEN}`]);
  });

  it('says the CLI must log in again when the fresh token is refused too, and forgets it', async () => {
    const { api, fetchFunction, invalidate } = setup([unauthorized]);

    const error = await api.getRaw('/a').catch((caught) => caught);

    expect(error).toBeInstanceOf(GithubSignInRequiredError);
    expect(error.reason).toBe('logged-out');
    expect(fetchFunction).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(error.message).not.toContain(FAKE_TOKEN);
  });

  it('says single sign-on is needed when GitHub sends X-GitHub-SSO with a 403', async () => {
    const sso = () =>
      new Response('{"message":"Resource protected by organization SAML enforcement."}', {
        status: 403,
        headers: { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso' },
      });
    const { api } = setup([sso]);

    await expect(api.getJson('/a')).rejects.toMatchObject({ reason: 'sso' });
  });

  it('reports any other 403 or 404 as before', async () => {
    const forbidden = setup([() => new Response('{}', { status: 403 })]);
    const missing = setup([() => new Response('{}', { status: 404 })]);

    await expect(forbidden.api.getJson('/a')).rejects.toThrow('GitHub answered 403');
    expect(await missing.api.getRaw('/a')).toBeUndefined();
    expect(forbidden.invalidate).not.toHaveBeenCalled();
  });
});

describe('createGithubApi in token mode', () => {
  it('reports a 401 as before, without retrying', async () => {
    const fetchFunction = vi.fn(async () => unauthorized());
    const api = createGithubApi({
      token: 'fake-github-token-for-tests',
      fetch: /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchFunction)),
    });

    await expect(api.getJson('/a')).rejects.toThrow('GitHub answered 401');
    expect(fetchFunction).toHaveBeenCalledOnce();
  });

  it('reports a 403 with X-GitHub-SSO as before', async () => {
    const fetchFunction = vi.fn(
      async () => new Response('{}', { status: 403, headers: { 'X-GitHub-SSO': 'required' } }),
    );
    const api = createGithubApi({
      token: 'fake-github-token-for-tests',
      fetch: /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchFunction)),
    });

    await expect(api.getJson('/a')).rejects.toThrow('GitHub answered 403');
  });
});
