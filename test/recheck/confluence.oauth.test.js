// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { pageFingerprint } from '../../src/citations/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createConfluenceChecker } from '../../src/recheck/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { confluenceSource } from '../helpers/sources.js';

describe('createConfluenceChecker without an API token', () => {
  it('does not ask the REST route and says the page could not be checked', async () => {
    const { stream } = createMemoryStream();
    const fetch = vi.fn();
    const checker = createConfluenceChecker({
      atlassian: {
        siteUrl: 'https://acme.atlassian.net',
        cloudId: '11111111-2222-3333-4444-555555555555',
        auth: { mode: 'oauth', dir: '/home/ada/.role-aware-assistant' },
        apiToken: undefined,
        spaceKeys: ['PAY', 'ENG'],
      },
      logger: createLogger({ destination: stream }),
      fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fetch)),
    });

    const status = await checker.check({
      ...confluenceSource({ id: '262439', version: 3 }),
      fingerprint: pageFingerprint(3),
    });

    expect(status).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
