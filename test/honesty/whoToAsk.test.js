// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { buildWhoToAsk, MAX_PEOPLE } from '../../src/honesty/index.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

/**
 * Gives a source the key it would have in a registry.
 * @param {import('../../src/citations/index.js').Source} source - The source.
 * @param {string} key - Its key.
 * @returns {import('../../src/citations/index.js').RegisteredSource} The registered source.
 */
const keyed = (source, key) => ({ ...source, key });

/**
 * Builds a lookup that answers from a table of path to owners.
 * @param {Record<string, string[]>} owners - Owners by `repo:path`.
 * @returns {{ ownersOf: import('vitest').Mock<(repo: string, path: string) => Promise<string[]>> }} The lookup.
 */
function lookupWith(owners) {
  return { ownersOf: vi.fn(async (repo, path) => owners[`${repo}:${path}`] ?? []) };
}

describe('buildWhoToAsk Confluence', () => {
  it('suggests whoever saved the page, tied to its key', async () => {
    const sources = [keyed(confluenceSource({ lastEditor: 'Dana Reyes' }), 'C1')];

    expect(await buildWhoToAsk({ sources, lookup: lookupWith({}) })).toEqual([
      { name: 'Dana Reyes', sourceKeys: ['C1'] },
    ]);
  });

  it('suggests nobody for a page that does not say who saved it', async () => {
    const sources = [keyed(confluenceSource(), 'C1')];

    expect(await buildWhoToAsk({ sources, lookup: lookupWith({}) })).toEqual([]);
  });

  it('puts one person once, with every page they edited', async () => {
    const sources = [
      keyed(confluenceSource({ id: '1', lastEditor: 'Dana Reyes' }), 'C1'),
      keyed(confluenceSource({ id: '2', lastEditor: 'Dana Reyes' }), 'C2'),
    ];

    expect(await buildWhoToAsk({ sources, lookup: lookupWith({}) })).toEqual([
      { name: 'Dana Reyes', sourceKeys: ['C1', 'C2'] },
    ]);
  });
});

describe('buildWhoToAsk GitHub', () => {
  it('suggests the CODEOWNERS of a file', async () => {
    const sources = [keyed(githubSource({ path: 'src/refunds/policy.ts' }), 'G1')];
    const lookup = lookupWith({
      'acme/payments-service:src/refunds/policy.ts': ['@acme/payments', '@alice'],
    });

    expect(await buildWhoToAsk({ sources, lookup })).toEqual([
      { name: '@acme/payments', sourceKeys: ['G1'] },
      { name: '@alice', sourceKeys: ['G1'] },
    ]);
  });

  it('asks about a folder as it would about a file inside it', async () => {
    const sources = [keyed(githubSource({ path: 'src/refunds', kind: 'directory' }), 'G1')];
    const lookup = lookupWith({ 'acme/payments-service:src/refunds/_': ['@acme/payments'] });

    expect(await buildWhoToAsk({ sources, lookup })).toEqual([
      { name: '@acme/payments', sourceKeys: ['G1'] },
    ]);
  });

  it.each([
    ['the top folder', { path: '', kind: 'directory' }],
    ['a commit', { path: '', kind: 'commit' }],
    ['a release', { path: '', kind: 'release' }],
  ])('does not ask about %s', async (_name, changes) => {
    const lookup = lookupWith({});

    const people = await buildWhoToAsk({
      sources: [keyed(githubSource(/** @type {any} */ (changes)), 'G1')],
      lookup,
    });

    expect(people).toEqual([]);
    expect(lookup.ownersOf).not.toHaveBeenCalled();
  });

  it('gives nothing for a file nobody owns', async () => {
    const sources = [keyed(githubSource(), 'G1')];

    expect(await buildWhoToAsk({ sources, lookup: lookupWith({}) })).toEqual([]);
  });

  it('puts a team that owns several files once, with each key', async () => {
    const sources = [
      keyed(githubSource({ path: 'a.ts' }), 'G1'),
      keyed(githubSource({ path: 'b.ts' }), 'G2'),
      keyed(githubSource({ path: 'b.ts', commitSha: 'f'.repeat(40) }), 'G3'),
    ];
    const lookup = lookupWith({
      'acme/payments-service:a.ts': ['@acme/payments'],
      'acme/payments-service:b.ts': ['@acme/payments', '@bob'],
    });

    expect(await buildWhoToAsk({ sources, lookup })).toEqual([
      { name: '@acme/payments', sourceKeys: ['G1', 'G2', 'G3'] },
      { name: '@bob', sourceKeys: ['G2', 'G3'] },
    ]);
  });
});

describe('buildWhoToAsk several sources', () => {
  it('lists page editors and code owners together, in source order', async () => {
    const sources = [
      keyed(confluenceSource({ lastEditor: 'Dana Reyes' }), 'C1'),
      keyed(githubSource({ path: 'a.ts' }), 'G1'),
    ];
    const lookup = lookupWith({ 'acme/payments-service:a.ts': ['@acme/payments'] });

    expect((await buildWhoToAsk({ sources, lookup })).map(({ name }) => name)).toEqual([
      'Dana Reyes',
      '@acme/payments',
    ]);
  });

  it('suggests at most five people', async () => {
    const sources = Array.from({ length: 8 }, (_, index) =>
      keyed(
        confluenceSource({ id: String(index), lastEditor: `Person ${index}` }),
        `C${index + 1}`,
      ),
    );

    const people = await buildWhoToAsk({ sources, lookup: lookupWith({}) });

    expect(people).toHaveLength(MAX_PEOPLE);
    expect(people[0].name).toBe('Person 0');
  });

  it('gives nothing when there are no sources', async () => {
    expect(await buildWhoToAsk({ sources: [], lookup: lookupWith({}) })).toEqual([]);
  });
});
