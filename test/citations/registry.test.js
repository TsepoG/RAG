// @ts-check
import { describe, expect, it } from 'vitest';
import { createCitationRegistry, isKeyShaped } from '../../src/citations/registry.js';
import { confluenceSource, githubSource, OTHER_COMMIT_SHA } from '../helpers/sources.js';

describe('createCitationRegistry keys', () => {
  it('numbers Confluence pages C1, C2 and GitHub sources G1, G2, each from one', () => {
    const registry = createCitationRegistry();

    const keys = [
      registry.register(confluenceSource({ id: '1' })),
      registry.register(githubSource({ path: 'a.js' })),
      registry.register(confluenceSource({ id: '2' })),
      registry.register(githubSource({ path: 'b.js' })),
    ];

    expect(keys).toEqual(['C1', 'G1', 'C2', 'G2']);
  });

  it('gives the same key to the same page and version, however often it is registered', () => {
    const registry = createCitationRegistry();

    const first = registry.register(confluenceSource());
    registry.register(githubSource());
    const again = registry.register(confluenceSource({ title: 'Renamed', url: 'https://x/y' }));

    expect(again).toBe(first);
    expect(registry.list()).toHaveLength(2);
  });

  it('gives a new version of the same page a new key', () => {
    const registry = createCitationRegistry();

    expect(registry.register(confluenceSource({ version: 3 }))).toBe('C1');
    expect(registry.register(confluenceSource({ version: 4 }))).toBe('C2');
  });

  it('gives the same file at the same commit the same key, ignoring the case of the repository', () => {
    const registry = createCitationRegistry();

    const first = registry.register(githubSource());
    const again = registry.register(githubSource({ repo: 'ACME/Payments-Service' }));

    expect(again).toBe(first);
  });

  it('gives the same file at a different commit, or a different path, a new key', () => {
    const registry = createCitationRegistry();

    registry.register(githubSource());

    expect(registry.register(githubSource({ commitSha: OTHER_COMMIT_SHA }))).toBe('G2');
    expect(registry.register(githubSource({ path: 'other.ts' }))).toBe('G3');
  });

  it('treats a commit, a release and a file as different sources even with the same path', () => {
    const registry = createCitationRegistry();

    registry.register(githubSource({ kind: 'file', path: '' }));

    expect(registry.register(githubSource({ kind: 'commit', path: '' }))).toBe('G2');
    expect(registry.register(githubSource({ kind: 'release', path: '' }))).toBe('G3');
  });
});

describe('createCitationRegistry releases', () => {
  it('tells two releases on the same commit apart by their tag', () => {
    const registry = createCitationRegistry();
    const release = (/** @type {string} */ title) =>
      githubSource({ kind: 'release', path: '', title });

    expect(registry.register(release('v1.0.0'))).toBe('G1');
    expect(registry.register(release('v1.0.1'))).toBe('G2');
    expect(registry.register(release('v1.0.0'))).toBe('G1');
  });
});

describe('createCitationRegistry lookups', () => {
  it('finds a registered source by key, including its key', () => {
    const registry = createCitationRegistry();
    registry.register(confluenceSource());

    expect(registry.get('C1')).toEqual({ ...confluenceSource(), key: 'C1' });
  });

  it('finds nothing for a key that was never registered', () => {
    expect(createCitationRegistry().get('C1')).toBeUndefined();
  });

  it('freezes what it stores, so a caller cannot change a source after the fact', () => {
    const registry = createCitationRegistry();
    registry.register(confluenceSource());

    expect(Object.isFrozen(registry.get('C1'))).toBe(true);
  });

  it('does not change the source it was given', () => {
    const registry = createCitationRegistry();
    const source = confluenceSource();

    registry.register(source);

    expect(source).toEqual(confluenceSource());
    expect('key' in source).toBe(false);
  });

  it('lists Confluence sources first, then GitHub, each by number rather than by text', () => {
    const registry = createCitationRegistry();
    for (let index = 1; index <= 10; index += 1) {
      registry.register(githubSource({ path: `f${index}.js` }));
    }
    registry.register(confluenceSource({ id: '1' }));

    expect(registry.list().map(({ key }) => key)).toEqual([
      'C1',
      'G1',
      'G2',
      'G3',
      'G4',
      'G5',
      'G6',
      'G7',
      'G8',
      'G9',
      'G10',
    ]);
  });

  it('lists nothing when empty', () => {
    expect(createCitationRegistry().list()).toEqual([]);
  });
});

describe('createCitationRegistry candidates', () => {
  const hit = { type: /** @type {const} */ ('confluence'), title: 'Found', url: 'https://x/a' };

  it('keeps search hits in the order seen, once per link', () => {
    const registry = createCitationRegistry();

    registry.addCandidate(hit);
    registry.addCandidate({ ...hit, url: 'https://x/b' });
    registry.addCandidate({ ...hit, title: 'Same link again' });

    expect(registry.candidates().map(({ url }) => url)).toEqual(['https://x/a', 'https://x/b']);
    expect(registry.candidates()[0].title).toBe('Found');
  });

  it('never makes a search hit citable', () => {
    const registry = createCitationRegistry();

    registry.addCandidate(hit);

    expect(registry.list()).toEqual([]);
    expect(registry.get('C1')).toBeUndefined();
  });

  it('does not let a candidate use up a key', () => {
    const registry = createCitationRegistry();
    registry.addCandidate(hit);

    expect(registry.register(confluenceSource())).toBe('C1');
  });

  it('freezes the candidates it stores', () => {
    const registry = createCitationRegistry();
    registry.addCandidate(hit);

    expect(Object.isFrozen(registry.candidates()[0])).toBe(true);
  });

  it('keeps separate registries separate', () => {
    const first = createCitationRegistry();
    const second = createCitationRegistry();

    first.register(confluenceSource());
    first.addCandidate(hit);

    expect(second.list()).toEqual([]);
    expect(second.candidates()).toEqual([]);
    expect(second.register(confluenceSource({ id: '9' }))).toBe('C1');
  });
});

describe('isKeyShaped', () => {
  it.each(['C1', 'G2', 'C10', 'G123'])('accepts %s', (text) => {
    expect(isKeyShaped(text)).toBe(true);
  });

  it.each(['c1', 'X1', 'C', 'C0', 'C01', 'C1a', ' C1', 'C-1', ''])('rejects %j', (text) => {
    expect(isKeyShaped(text)).toBe(false);
  });
});
