// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createCommitResolver } from '../../src/github/commits.js';
import { createLogger } from '../../src/logger/index.js';
import { FAKE_GITHUB_TOKEN } from '../helpers/env.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const SHA = 'ebf99bea1fdf70b3a206c622a5134068c73eb607';
const REPOS = ['acme/app', 'acme/docs'];

/**
 * Builds a fake fetch that answers each URL from a table.
 * @param {Record<string, unknown | (() => Response | Promise<Response>)>} answers - JSON bodies by
 *   URL path, or functions that make a response (or throw).
 * @returns {ReturnType<typeof vi.fn>} The fake.
 */
function fakeFetch(answers) {
  return vi.fn(async (/** @type {string} */ url) => {
    const path = url.replace('https://api.github.com', '');
    const answer = answers[path];
    if (typeof answer === 'function') {
      return answer();
    }
    return new Response(JSON.stringify(answer ?? {}), {
      status: answer === undefined ? 404 : 200,
    });
  });
}

/**
 * Builds a resolver around a fake fetch, with a logger that writes into memory.
 * @param {ReturnType<typeof vi.fn>} fetchFunction - The fake.
 * @returns {{ resolver: ReturnType<typeof createCommitResolver>, lines: () => Array<Record<string, unknown>> }}
 *   The resolver and the log lines.
 */
function setup(fetchFunction) {
  const { stream, lines } = createMemoryStream();
  const resolver = createCommitResolver({
    token: FAKE_GITHUB_TOKEN,
    repos: REPOS,
    fetch: /** @type {typeof fetch} */ (fetchFunction),
    logger: createLogger({ level: 'debug', destination: stream }),
  });
  return { resolver, lines };
}

const WORKING = {
  '/repos/acme/app': { default_branch: 'main' },
  '/repos/acme/app/commits/main': { sha: SHA },
};

describe('createCommitResolver lookups', () => {
  it('finds the default branch, then the head commit of that branch', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver } = setup(fetchFunction);

    expect(await resolver.resolveHead('acme/app')).toBe(SHA);

    expect(fetchFunction.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/acme/app',
      'https://api.github.com/repos/acme/app/commits/main',
    ]);
  });

  it('encodes each part of a branch name that contains slashes', async () => {
    const fetchFunction = fakeFetch({
      '/repos/acme/app': { default_branch: 'release/v 1' },
      '/repos/acme/app/commits/release/v%201': { sha: SHA },
    });
    const { resolver } = setup(fetchFunction);

    expect(await resolver.resolveHead('acme/app')).toBe(SHA);
  });

  it('asks for each repository only once, however often it is asked about', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver } = setup(fetchFunction);

    await resolver.resolveHead('acme/app');
    await resolver.resolveHead('acme/app');
    await resolver.resolveHead('ACME/App');

    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between questions asked at the same moment', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver } = setup(fetchFunction);

    const results = await Promise.all([
      resolver.resolveHead('acme/app'),
      resolver.resolveHead('acme/app'),
      resolver.resolveHead('acme/app'),
    ]);

    expect(results).toEqual([SHA, SHA, SHA]);
    expect(fetchFunction).toHaveBeenCalledTimes(2);
  });

  it('keeps repositories apart', async () => {
    const fetchFunction = fakeFetch({
      ...WORKING,
      '/repos/acme/docs': { default_branch: 'trunk' },
      '/repos/acme/docs/commits/trunk': { sha: 'a'.repeat(40) },
    });
    const { resolver } = setup(fetchFunction);

    expect(await resolver.resolveHead('acme/app')).toBe(SHA);
    expect(await resolver.resolveHead('acme/docs')).toBe('a'.repeat(40));
    expect(fetchFunction).toHaveBeenCalledTimes(4);
  });

  it("keeps one resolver's answers out of another", async () => {
    const first = fakeFetch(WORKING);
    const second = fakeFetch(WORKING);

    await setup(first).resolver.resolveHead('acme/app');
    await setup(second).resolver.resolveHead('acme/app');

    expect(second).toHaveBeenCalledTimes(2);
  });

  it('uses the global fetch when none is given', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = /** @type {typeof fetch} */ (fakeFetch(WORKING));
    try {
      const resolver = createCommitResolver({ token: FAKE_GITHUB_TOKEN, repos: REPOS });

      expect(await resolver.resolveHead('acme/app')).toBe(SHA);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('createCommitResolver scope', () => {
  it('refuses a repository that is not in the allowed list, without any request', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver, lines } = setup(fetchFunction);

    expect(await resolver.resolveHead('evil/secrets')).toBeUndefined();

    expect(fetchFunction).not.toHaveBeenCalled();
    expect(lines().at(-1)).toMatchObject({ level: 'warn', repo: 'evil/secrets' });
  });

  it.each(['acme/app', 'ACME/APP', 'Acme/App'])('allows %s whatever its case', async (repo) => {
    const { resolver } = setup(fakeFetch(WORKING));

    expect(await resolver.resolveHead(repo)).toBe(SHA);
  });

  it('works without a logger', async () => {
    const resolver = createCommitResolver({
      token: FAKE_GITHUB_TOKEN,
      repos: REPOS,
      fetch: /** @type {typeof fetch} */ (fakeFetch({})),
    });

    expect(await resolver.resolveHead('evil/x')).toBeUndefined();
    expect(await resolver.resolveHead('acme/app')).toBeUndefined();
  });
});

describe('createCommitResolver token', () => {
  it('sends the token only in the Authorization header', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver } = setup(fetchFunction);

    await resolver.resolveHead('acme/app');

    for (const [url, init] of fetchFunction.mock.calls) {
      expect(url).not.toContain(FAKE_GITHUB_TOKEN);
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_GITHUB_TOKEN}`);
      const others = Object.entries(init.headers).filter(([name]) => name !== 'Authorization');
      expect(JSON.stringify(others)).not.toContain(FAKE_GITHUB_TOKEN);
      expect(init.body).toBeUndefined();
    }
  });

  it('only reads: every request is a GET with a time limit', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver } = setup(fetchFunction);

    await resolver.resolveHead('acme/app');

    for (const [, init] of fetchFunction.mock.calls) {
      expect(init.method).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('says what it is asking for in the headers GitHub expects', async () => {
    const fetchFunction = fakeFetch(WORKING);
    const { resolver } = setup(fetchFunction);

    await resolver.resolveHead('acme/app');

    expect(fetchFunction.mock.calls[0][1].headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'role-aware-assistant',
    });
  });

  it('never logs the token, in success or failure', async () => {
    const failing = fakeFetch({
      '/repos/acme/app': () => new Response('{"message":"bad"}', { status: 401 }),
    });
    const { resolver, lines } = setup(failing);
    const working = setup(fakeFetch(WORKING));

    await resolver.resolveHead('acme/app');
    await working.resolver.resolveHead('acme/app');
    await resolver.resolveHead('evil/x');

    expect(JSON.stringify(lines())).not.toContain(FAKE_GITHUB_TOKEN);
    expect(JSON.stringify(working.lines())).not.toContain(FAKE_GITHUB_TOKEN);
  });
});

describe('createCommitResolver failures', () => {
  it.each([
    ['the repository is not found', { '/repos/acme/app': undefined }],
    [
      'the commit is not found',
      { '/repos/acme/app': { default_branch: 'main' }, '/repos/acme/app/commits/main': undefined },
    ],
    ['there is no default branch', { '/repos/acme/app': {} }],
    ['the default branch is empty', { '/repos/acme/app': { default_branch: '' } }],
    ['the default branch is not text', { '/repos/acme/app': { default_branch: 7 } }],
    [
      'the commit has no SHA',
      { '/repos/acme/app': { default_branch: 'main' }, '/repos/acme/app/commits/main': {} },
    ],
    [
      'the SHA is short',
      {
        '/repos/acme/app': { default_branch: 'main' },
        '/repos/acme/app/commits/main': { sha: 'ebf99be' },
      },
    ],
    [
      'the SHA is not text',
      { '/repos/acme/app': { default_branch: 'main' }, '/repos/acme/app/commits/main': { sha: 5 } },
    ],
    ['the answer is not an object', { '/repos/acme/app': () => new Response('null') }],
  ])('gives undefined when %s', async (_what, answers) => {
    const { resolver } = setup(fakeFetch(answers));

    expect(await resolver.resolveHead('acme/app')).toBeUndefined();
  });

  it('gives undefined, and says why, when GitHub answers with an error status', async () => {
    const { resolver, lines } = setup(
      fakeFetch({ '/repos/acme/app': () => new Response('x', { status: 403 }) }),
    );

    expect(await resolver.resolveHead('acme/app')).toBeUndefined();

    expect(lines().at(-1)).toMatchObject({
      level: 'warn',
      repo: 'acme/app',
      reason: 'GitHub answered 403',
      msg: 'could not look up the head commit',
    });
  });

  it('gives undefined, naming only the kind of error, when the network fails', async () => {
    const { resolver, lines } = setup(
      fakeFetch({
        '/repos/acme/app': () => {
          throw new TypeError(`fetch failed for ${FAKE_GITHUB_TOKEN}`);
        },
      }),
    );

    expect(await resolver.resolveHead('acme/app')).toBeUndefined();

    expect(lines().at(-1)).toMatchObject({ reason: 'TypeError' });
    expect(JSON.stringify(lines())).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it('gives undefined when the answer is not JSON, without repeating any of it', async () => {
    const { resolver, lines } = setup(
      fakeFetch({ '/repos/acme/app': () => new Response('<html>secret page</html>') }),
    );

    expect(await resolver.resolveHead('acme/app')).toBeUndefined();

    expect(lines().at(-1)).toMatchObject({ reason: 'SyntaxError' });
    expect(JSON.stringify(lines())).not.toContain('secret page');
  });

  it('gives undefined for something thrown that is not an Error', async () => {
    const { resolver, lines } = setup(
      fakeFetch({
        '/repos/acme/app': () => {
          throw 'plain text';
        },
      }),
    );

    expect(await resolver.resolveHead('acme/app')).toBeUndefined();

    expect(lines().at(-1)).toMatchObject({ reason: 'unknown' });
  });

  it('remembers a failure, so a broken repository is not asked about again', async () => {
    const fetchFunction = fakeFetch({ '/repos/acme/app': undefined });
    const { resolver } = setup(fetchFunction);

    await resolver.resolveHead('acme/app');
    await resolver.resolveHead('acme/app');

    expect(fetchFunction).toHaveBeenCalledTimes(1);
  });

  it('never throws', async () => {
    const { resolver } = setup(
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );

    await expect(resolver.resolveHead('acme/app')).resolves.toBeUndefined();
  });
});
