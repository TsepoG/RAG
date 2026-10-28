// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchAuthStatus, signOut } from '../../../public/js/api.js';

/**
 * A fake fetch that answers once with JSON.
 * @param {unknown} body - The body.
 * @param {number} [status] - The status.
 * @returns {import('vitest').Mock & typeof fetch} The fake.
 */
function answering(body, status = 200) {
  return /** @type {any} */ (vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe('fetchAuthStatus', () => {
  it('reads the sign-in status', async () => {
    const fetchFunction = answering({ mode: 'oauth', signedIn: false });

    expect(await fetchAuthStatus(fetchFunction)).toEqual({ mode: 'oauth', signedIn: false });
    expect(fetchFunction).toHaveBeenCalledWith('/api/auth/status', {
      headers: { Accept: 'application/json' },
    });
  });

  it('turns a failure into an ApiError', async () => {
    await expect(fetchAuthStatus(answering({ message: 'No' }, 500))).rejects.toThrow(ApiError);
  });
});

describe('signOut', () => {
  it('posts an empty JSON body to sign out', async () => {
    const fetchFunction = answering({ signedOut: true, revoked: true });

    expect(await signOut(fetchFunction)).toEqual({ signedOut: true, revoked: true });
    expect(fetchFunction).toHaveBeenCalledWith('/api/auth/atlassian/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: undefined,
    });
  });
});

describe('the default fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the browser fetch for both calls', async () => {
    const fetchFunction = vi.fn(async () => new Response('{"mode":"basic","signedIn":true}'));
    vi.stubGlobal('fetch', fetchFunction);

    await fetchAuthStatus();
    await signOut();

    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });
});
