// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, checkGithub, createConversation } from '../../../public/js/api.js';

/**
 * A fake fetch that answers once with JSON.
 * @param {unknown} body - The body.
 * @param {number} [status] - The status.
 * @returns {import('vitest').Mock & typeof fetch} The fake.
 */
function answering(body, status = 200) {
  return /** @type {any} */ (vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkGithub', () => {
  it('posts an empty JSON body and gives the status back', async () => {
    const status = { mode: 'basic', signedIn: true, github: { mode: 'gh-cli', signedIn: true } };
    const fetchFunction = answering(status);

    expect(await checkGithub(fetchFunction)).toEqual(status);
    expect(fetchFunction).toHaveBeenCalledWith('/api/auth/github/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: undefined,
    });
  });

  it('uses the browser fetch by default', async () => {
    const fetchFunction = vi.fn(async () => new Response('{"mode":"basic","signedIn":true}'));
    vi.stubGlobal('fetch', fetchFunction);

    await checkGithub();

    expect(fetchFunction).toHaveBeenCalledOnce();
  });
});

describe('a refusal that needs the GitHub CLI', () => {
  it('keeps the code and the reason the server gave', async () => {
    const fetchFunction = answering(
      { code: 'github_signin_required', reason: 'sso', message: 'Run gh auth refresh.' },
      401,
    );

    const error = await createConversation('dev', fetchFunction).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'github_signin_required', reason: 'sso' });
  });

  it('has no reason when the server gave none', async () => {
    const error = await createConversation('dev', answering({ message: 'No' }, 500)).catch(
      (caught) => caught,
    );

    expect(error).not.toHaveProperty('reason');
  });
});
