// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { pageFingerprint } from '../../src/citations/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createConfluenceChecker } from '../../src/recheck/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { confluenceSource } from '../helpers/sources.js';

const CLOUD_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'fake-atlassian-token-for-tests';
const SERVICE_ACCOUNT = {
  siteUrl: 'https://acme.atlassian.net',
  cloudId: CLOUD_ID,
  auth: /** @type {const} */ ({ mode: 'bearer' }),
  apiToken: TOKEN,
  spaceKeys: ['PAY', 'ENG'],
};

/**
 * A checker whose fetch answers with the given response, and a log to look at.
 * @param {Response | Error} answer - What Atlassian says; an error is a failed request.
 * @param {Partial<typeof SERVICE_ACCOUNT> | { auth: { mode: 'basic', email: string } }} [settings] - Settings to change.
 * @returns {{ checker: ReturnType<typeof createConfluenceChecker>, fetch: import('vitest').Mock, lines: () => Array<Record<string, unknown>> }} The checker and its doubles.
 */
function setup(answer, settings = {}) {
  const { stream, lines } = createMemoryStream();
  const fetch = vi.fn(async () => {
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  const checker = createConfluenceChecker({
    atlassian: { ...SERVICE_ACCOUNT, ...settings },
    logger: createLogger({ level: 'debug', destination: stream }),
    fetch: /** @type {typeof globalThis.fetch} */ (fetch),
  });
  return { checker, fetch, lines };
}

/**
 * A page lookup answer.
 * @param {unknown} body - The JSON body.
 * @param {number} [status] - The status.
 * @returns {Response} The response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A page source with a fingerprint.
 * @param {Partial<import('../../src/citations/index.js').ConfluenceSource>} [overrides] - Fields to change.
 * @returns {import('../../src/citations/index.js').ConfluenceSource & { fingerprint: string }} The source.
 */
function page(overrides = {}) {
  return {
    ...confluenceSource({ id: '262439', version: 3, ...overrides }),
    fingerprint: pageFingerprint(3),
  };
}

describe('checking a page', () => {
  it('is unchanged when the live version is the one the model read', async () => {
    const { checker } = setup(json({ version: { number: 3 } }));

    expect(await checker.check(page())).toBe('unchanged');
  });

  it('compares with the version it was fetched at when there is no fingerprint', async () => {
    const { fingerprint, ...bare } = page({ version: 3 });
    const same = setup(json({ version: { number: 3 } }));
    const newer = setup(json({ version: { number: 4 } }));

    expect(fingerprint).toBe(pageFingerprint(3));
    expect(await same.checker.check(bare)).toBe('unchanged');
    expect(await newer.checker.check(bare)).toBe('changed');
  });

  it('is changed when the page has a newer version', async () => {
    const { checker } = setup(json({ version: { number: 4 } }));

    expect(await checker.check(page())).toBe('changed');
  });

  it('is changed when the page is gone', async () => {
    const { checker } = setup(new Response('', { status: 404 }));

    expect(await checker.check(page())).toBe('changed');
  });

  it('asks the Atlassian gateway for the page with the service-account key as a Bearer token', async () => {
    const { checker, fetch } = setup(json({ version: { number: 3 } }));

    await checker.check(page());

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(
      `https://api.atlassian.com/ex/confluence/${CLOUD_ID}/wiki/api/v2/pages/262439`,
    );
    expect(options.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks the site directly, with Basic credentials, when a personal token is used', async () => {
    const { checker, fetch } = setup(json({ version: { number: 3 } }), {
      auth: { mode: 'basic', email: 'dev@acme.example' },
    });

    expect(await checker.check(page())).toBe('unchanged');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/wiki/api/v2/pages/262439');
    const credentials = Buffer.from('dev@acme.example:' + TOKEN).toString('base64');
    expect(options.headers.Authorization).toBe('Basic ' + credentials);
  });
});

describe('when a page cannot be checked', () => {
  it.each([
    ['a refusal', json({}, 403)],
    ['a server error', json({}, 500)],
  ])('is unavailable after %s, and logs only the status', async (_what, answer) => {
    const { checker, lines } = setup(answer);

    expect(await checker.check(page())).toBe('unavailable');
    expect(lines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'could not re-check a page',
        status: answer.status,
      }),
    );
    expect(JSON.stringify(lines())).not.toContain(TOKEN);
  });

  it.each([
    ['has no version', {}],
    ['has a version that is not a number', { version: { number: 'three' } }],
    ['is not an object', null],
  ])('is unavailable when the answer %s', async (_what, body) => {
    const { checker } = setup(json(body));

    expect(await checker.check(page())).toBe('unavailable');
  });

  it('is unavailable after a network failure, naming only its type', async () => {
    const { checker, lines } = setup(new TypeError(`fetch failed for ${TOKEN}`));

    expect(await checker.check(page())).toBe('unavailable');
    expect(lines()).toContainEqual(expect.objectContaining({ reason: 'TypeError' }));
    expect(JSON.stringify(lines())).not.toContain(TOKEN);
  });

  it('names an unknown failure as unknown', async () => {
    const { stream, lines } = createMemoryStream();
    const checker = createConfluenceChecker({
      atlassian: SERVICE_ACCOUNT,
      logger: createLogger({ level: 'debug', destination: stream }),
      fetch: /** @type {any} */ (() => Promise.reject('plain string')),
    });

    expect(await checker.check(page())).toBe('unavailable');
    expect(lines()).toContainEqual(expect.objectContaining({ reason: 'unknown' }));
  });

  it('does not ask without a cloud id when a service-account key is used', async () => {
    const { checker, fetch } = setup(json({ version: { number: 3 } }), { cloudId: undefined });

    expect(await checker.check(page())).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not ask about a page outside the allowed spaces', async () => {
    const { checker, fetch } = setup(json({ version: { number: 3 } }));

    expect(await checker.check(page({ spaceKey: 'HR' }))).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('matches the allowed spaces whatever the case', async () => {
    const { checker } = setup(json({ version: { number: 3 } }));

    expect(await checker.check(page({ spaceKey: 'pay' }))).toBe('unchanged');
  });

  it('does not put an id that is not digits into a request', async () => {
    const { checker, fetch } = setup(json({ version: { number: 3 } }));

    expect(await checker.check(page({ id: '1/../2' }))).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
