// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { blobFingerprint } from '../../src/citations/index.js';
import { createGithubApi } from '../../src/github/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createGithubChecker } from '../../src/recheck/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { githubSource } from '../helpers/sources.js';

const FAKE_CLI_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';
const BLOB = '57f682c9d938c83e89b36d164d53cfd37a5d7893';
const OTHER_BLOB = 'd80951b943c0ee2f7d7902e6dfb269b0056ea3d7';
const REPO = 'acme/payments-service';
const FILE = { ...githubSource({ path: 'src/a.js' }), fingerprint: blobFingerprint(BLOB) };

/**
 * A checker over the real GitHub client in gh-cli mode, with a fake fetch.
 * @param {Array<() => Response>} answers - What GitHub answers, in turn (the last repeats).
 * @returns {{ checker: ReturnType<typeof createGithubChecker>, fetchFunction: import('vitest').Mock, provider: { getGithubToken: import('vitest').Mock, invalidate: import('vitest').Mock }, lines: () => Array<Record<string, unknown>> }} The pieces.
 */
function setup(answers) {
  let n = 0;
  const fetchFunction = vi.fn(async () => answers[Math.min(n++, answers.length - 1)]());
  const provider = { getGithubToken: vi.fn(async () => FAKE_CLI_TOKEN), invalidate: vi.fn() };
  const { stream, lines } = createMemoryStream();
  const checker = createGithubChecker({
    api: createGithubApi({
      getToken: () => provider.getGithubToken(),
      invalidate: () => provider.invalidate(),
      fetch: /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchFunction)),
    }),
    repos: [REPO],
    logger: createLogger({ level: 'debug', destination: stream }),
  });
  return { checker, fetchFunction, provider, lines };
}

describe('re-checking a GitHub file in gh-cli mode', () => {
  it("reads the file with the GitHub CLI's token and sees a change", async () => {
    const { checker, fetchFunction } = setup([() => new Response(`{"sha":"${OTHER_BLOB}"}`)]);

    expect(await checker.check(FILE)).toBe('changed');
    expect(fetchFunction.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${FAKE_CLI_TOKEN}`);
  });

  it('says it could not check, never "changed", when the CLI token is refused', async () => {
    const { checker, provider, lines } = setup([() => new Response('{}', { status: 401 })]);

    expect(await checker.check(FILE)).toBe('unavailable');
    expect(provider.invalidate).toHaveBeenCalled();
    expect(JSON.stringify(lines())).not.toContain(FAKE_CLI_TOKEN);
  });
});
