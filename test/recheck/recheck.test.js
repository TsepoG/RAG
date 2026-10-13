// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { blobFingerprint, pageFingerprint } from '../../src/citations/index.js';
import { recheckSources } from '../../src/recheck/index.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

/**
 * Checkers that answer from a table, and a clock the test sets.
 * @param {{ github?: string, confluence?: string }} [answers] - What each checker says.
 * @returns {{ checkers: import('../../src/recheck/index.js').Checkers, github: import('vitest').Mock, confluence: import('vitest').Mock }} The checkers.
 */
function setup({ github = 'unchanged', confluence = 'unchanged' } = {}) {
  const githubCheck = vi.fn(async () => github);
  const confluenceCheck = vi.fn(async () => confluence);
  return {
    github: githubCheck,
    confluence: confluenceCheck,
    checkers: /** @type {any} */ ({
      github: { check: githubCheck },
      confluence: { check: confluenceCheck },
      clock: { now: () => 5000 },
    }),
  };
}

const PAGE = { ...confluenceSource(), key: 'C1', fingerprint: pageFingerprint(3) };
const FILE = { ...githubSource(), key: 'G1', fingerprint: blobFingerprint('abc') };

describe('recheckSources', () => {
  it('sends a page to the Confluence checker and a file to the GitHub checker', async () => {
    const { checkers, github, confluence } = setup({ github: 'changed' });

    const results = await recheckSources([PAGE, FILE], checkers);

    expect(results).toEqual([
      { key: 'C1', status: 'unchanged', checkedAt: 5000 },
      { key: 'G1', status: 'changed', checkedAt: 5000 },
    ]);
    expect(confluence).toHaveBeenCalledExactlyOnceWith(PAGE);
    expect(github).toHaveBeenCalledExactlyOnceWith(FILE);
  });

  it('leaves out a commit or a single release, which never change and have no fingerprint', async () => {
    const { checkers, github } = setup();
    const commit = { ...githubSource({ kind: 'commit' }), key: 'G2' };

    const results = await recheckSources([commit], checkers);

    expect(results).toEqual([]);
    expect(github).not.toHaveBeenCalled();
  });

  it('still checks a file, a folder or a list of releases that has no fingerprint', async () => {
    const { checkers, github } = setup();
    const bare = [
      { ...githubSource({ kind: 'file' }), key: 'G2' },
      { ...githubSource({ kind: 'directory' }), key: 'G3' },
      { ...githubSource({ kind: 'releases' }), key: 'G4' },
    ];

    const results = await recheckSources(bare, checkers);

    expect(results.map(({ key }) => key)).toEqual(['G2', 'G3', 'G4']);
    expect(github).toHaveBeenCalledTimes(3);
  });

  it('leaves out a single release, which never changes', async () => {
    const { checkers } = setup();
    const release = { ...githubSource({ kind: 'release' }), key: 'G2' };

    expect(await recheckSources([release], checkers)).toEqual([]);
  });

  it('keeps the order it was given, and reports a source it could not check beside the others', async () => {
    const { checkers } = setup({ github: 'unavailable' });

    const results = await recheckSources([FILE, PAGE], checkers);

    expect(results.map(({ key, status }) => [key, status])).toEqual([
      ['G1', 'unavailable'],
      ['C1', 'unchanged'],
    ]);
  });

  it('checks nothing when given nothing', async () => {
    expect(await recheckSources([], setup().checkers)).toEqual([]);
  });
});
