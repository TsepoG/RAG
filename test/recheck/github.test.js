// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  blobFingerprint,
  entriesFingerprint,
  releaseListFingerprint,
} from '../../src/citations/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createGithubChecker } from '../../src/recheck/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';
import { githubSource } from '../helpers/sources.js';

const BLOB = '57f682c9d938c83e89b36d164d53cfd37a5d7893';
const OTHER_BLOB = 'd80951b943c0ee2f7d7902e6dfb269b0056ea3d7';
const REPO = 'acme/payments-service';

/**
 * A checker whose GitHub client answers from a table, and a log to look at.
 * @param {(path: string) => unknown} answer - What GitHub says for a path; a thrown error is a failure.
 * @returns {{ checker: ReturnType<typeof createGithubChecker>, getJson: import('vitest').Mock, lines: () => Array<Record<string, unknown>> }} The checker and its doubles.
 */
function setup(answer) {
  const { stream, lines } = createMemoryStream();
  const getJson = vi.fn(async (path) => /** @type {Record<string, unknown>} */ (answer(path)));
  const checker = createGithubChecker({
    api: { getJson },
    repos: [REPO],
    logger: createLogger({ level: 'debug', destination: stream }),
  });
  return { checker, getJson, lines };
}

/**
 * A file source with a fingerprint.
 * @param {Partial<import('../../src/citations/index.js').GithubSource>} overrides - Fields to change.
 * @param {string} fingerprint - The fingerprint.
 * @returns {import('../../src/citations/index.js').GithubSource & { fingerprint: string }} The source.
 */
function source(overrides, fingerprint) {
  return { ...githubSource(overrides), fingerprint };
}

const FILE = source({ path: 'src/a.js' }, blobFingerprint(BLOB));

/**
 * An error the way the GitHub client fails.
 * @param {number} status - The status GitHub answered.
 * @returns {Error} The error.
 */
function answered(status) {
  return new Error(`GitHub answered ${status}`);
}

describe('checking a file', () => {
  it('is unchanged when the blob on the default branch is the one the model read', async () => {
    const { checker, getJson } = setup(() => ({ sha: BLOB }));

    expect(await checker.check(FILE)).toBe('unchanged');
    expect(getJson).toHaveBeenCalledExactlyOnceWith(`/repos/${REPO}/contents/src/a.js`);
  });

  it('is changed when the file has a new blob', async () => {
    const { checker } = setup(() => ({ sha: OTHER_BLOB }));

    expect(await checker.check(FILE)).toBe('changed');
  });

  it('encodes each part of the path and keeps the slashes', async () => {
    const { checker, getJson } = setup(() => ({ sha: BLOB }));

    await checker.check(source({ path: 'docs/my file#1.md' }, blobFingerprint(BLOB)));

    expect(getJson).toHaveBeenCalledWith(`/repos/${REPO}/contents/docs/my%20file%231.md`);
  });

  it('is changed when the file is no longer there', async () => {
    const { checker } = setup(() => {
      throw answered(404);
    });

    expect(await checker.check(FILE)).toBe('changed');
  });

  it('is unavailable when the answer names no blob', async () => {
    const { checker } = setup(() => ({}));

    expect(await checker.check(FILE)).toBe('unavailable');
  });

  it('is unavailable when the answer is not an object at all', async () => {
    const { checker } = setup(() => null);

    expect(await checker.check(FILE)).toBe('unavailable');
  });
});

describe('checking a folder', () => {
  const entries = [
    { name: 'a.py', sha: BLOB },
    { name: 'b.py', sha: OTHER_BLOB },
  ];
  const FOLDER = source({ kind: 'directory', path: 'src' }, entriesFingerprint(entries));

  it('is unchanged when the same files have the same blobs, in any order', async () => {
    const { checker } = setup(() => [...entries].reverse());

    expect(await checker.check(FOLDER)).toBe('unchanged');
  });

  it.each([
    ['a file changed', [{ name: 'a.py', sha: OTHER_BLOB }, entries[1]]],
    ['a file was added', [...entries, { name: 'c.py', sha: BLOB }]],
    ['a file was removed', [entries[0]]],
  ])('is changed when %s', async (_what, live) => {
    const { checker } = setup(() => live);

    expect(await checker.check(FOLDER)).toBe('changed');
  });

  it('is unavailable when an entry has no name or no blob', async () => {
    const { checker } = setup(() => [{ name: 'a.py' }]);

    expect(await checker.check(FOLDER)).toBe('unavailable');
  });
});

describe('checking a list of releases', () => {
  const RELEASES = source({ kind: 'releases', path: '' }, releaseListFingerprint('v1.0.0'));

  it('asks only for the newest release', async () => {
    const { checker, getJson } = setup(() => [{ tag_name: 'v1.0.0' }]);

    expect(await checker.check(RELEASES)).toBe('unchanged');
    expect(getJson).toHaveBeenCalledWith(`/repos/${REPO}/releases?per_page=1`);
  });

  it('is changed when there is a newer tag', async () => {
    const { checker } = setup(() => [{ tag_name: 'v1.1.0' }]);

    expect(await checker.check(RELEASES)).toBe('changed');
  });

  it('names a release by its title when it has no tag', async () => {
    const { checker } = setup(() => [{ name: 'v1.0.0' }]);

    expect(await checker.check(RELEASES)).toBe('unchanged');
  });

  it('is unavailable when there is no release to name', async () => {
    const { checker } = setup(() => []);

    expect(await checker.check(RELEASES)).toBe('unavailable');
  });

  it('is unavailable when the answer is not a list', async () => {
    const { checker } = setup(() => ({}));

    expect(await checker.check(RELEASES)).toBe('unavailable');
  });
});

describe('when GitHub cannot be asked', () => {
  it('is unavailable after a failed request, and logs only the reason', async () => {
    const { checker, lines } = setup(() => {
      throw answered(500);
    });

    expect(await checker.check(FILE)).toBe('unavailable');
    expect(lines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'could not re-check a source',
        kind: 'file',
        reason: 'GitHub answered 500',
      }),
    );
    expect(JSON.stringify(lines())).not.toContain('src/a.js');
  });

  it('names a network failure by its type, never its message', async () => {
    const { checker, lines } = setup(() => {
      throw new TypeError('fetch failed for https://api.github.com/secret');
    });

    expect(await checker.check(FILE)).toBe('unavailable');
    expect(lines()).toContainEqual(expect.objectContaining({ reason: 'TypeError' }));
    expect(JSON.stringify(lines())).not.toContain('secret');
  });

  it('does not ask about a repository outside the allowed ones', async () => {
    const { checker, getJson, lines } = setup(() => ({ sha: BLOB }));

    const status = await checker.check(source({ repo: 'evil/other' }, blobFingerprint(BLOB)));

    expect(status).toBe('unavailable');
    expect(getJson).not.toHaveBeenCalled();
    expect(lines()).toContainEqual(
      expect.objectContaining({
        msg: 'did not re-check a source outside the allowed repositories',
      }),
    );
  });

  it('matches the allowed repositories whatever the case', async () => {
    const { checker } = setup(() => ({ sha: BLOB }));

    const status = await checker.check(
      source({ repo: 'ACME/Payments-Service' }, blobFingerprint(BLOB)),
    );

    expect(status).toBe('unchanged');
  });
});
