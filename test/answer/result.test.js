// @ts-check
import { describe, expect, it } from 'vitest';
import { assembleAnswer, MAX_ALSO_CONSULTED } from '../../src/answer/result.js';
import { createCitationRegistry } from '../../src/citations/index.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

const ROLE = { id: 'qa' };

/**
 * Builds a registry holding C1, C2 and G1.
 * @returns {ReturnType<typeof createCitationRegistry>} The registry.
 */
function registry() {
  const sources = createCitationRegistry();
  sources.register(confluenceSource({ id: '1', title: 'One', url: 'https://x/c1' }));
  sources.register(confluenceSource({ id: '2', title: 'Two', url: 'https://x/c2' }));
  sources.register(githubSource({ path: 'a.js', title: 'a.js', url: 'https://x/g1' }));
  return sources;
}

describe('assembleAnswer sources', () => {
  it('lists the cited sources in key order, each with a friendly label', () => {
    const result = assembleAnswer({
      answer: 'B [G1]. A [C2][C1].',
      role: ROLE,
      registry: registry(),
    });

    expect(result.sources.map(({ key }) => key)).toEqual(['C1', 'C2', 'G1']);
    expect(result.sources[0].friendlyLabel).toBe('One v3 — Confluence (PAY)');
    expect(result.sources[2].friendlyLabel).toBe('A — code (payments-service)');
  });

  it('carries every field of a cited source', () => {
    const { sources } = assembleAnswer({ answer: 'x [C1]', role: ROLE, registry: registry() });

    expect(sources[0]).toMatchObject({
      key: 'C1',
      type: 'confluence',
      id: '1',
      version: 3,
      spaceKey: 'PAY',
    });
  });

  it('marks a source inferred only when every citation of it carries an asterisk', () => {
    const result = assembleAnswer({
      answer: 'Guess [C1*]. Guess [G1*]. Fact [G1]. Fact [C2].',
      role: ROLE,
      registry: registry(),
    });

    expect(result.sources.map(({ key, inferred }) => [key, inferred])).toEqual([
      ['C1', true],
      ['C2', false],
      ['G1', false],
    ]);
    expect(result.inferredKeys).toEqual(['C1', 'G1']);
  });

  it('marks nothing inferred when there are no asterisks', () => {
    const result = assembleAnswer({ answer: 'x [C1][G1]', role: ROLE, registry: registry() });

    expect(result.sources.every(({ inferred }) => inferred === false)).toBe(true);
    expect(result.inferredKeys).toEqual([]);
  });

  it('leaves out sources the answer does not cite', () => {
    const result = assembleAnswer({ answer: 'x [C2]', role: ROLE, registry: registry() });

    expect(result.sources.map(({ key }) => key)).toEqual(['C2']);
    expect(result.uncitedSourceKeys).toEqual(['C1', 'G1']);
  });

  it('names the role and reports and strips invented keys', () => {
    const result = assembleAnswer({ answer: 'x [C1][C9]', role: ROLE, registry: registry() });

    expect(result).toMatchObject({ role: 'qa', answer: 'x [C1]', invalidKeys: ['C9'] });
  });
});

describe('assembleAnswer alsoConsulted', () => {
  it('lists uncited fetched sources first, with their keys, then search hits', () => {
    const sources = registry();
    sources.addCandidate({ type: 'github', title: 'Hit', url: 'https://x/hit' });

    const { alsoConsulted } = assembleAnswer({ answer: 'x [C1]', role: ROLE, registry: sources });

    expect(alsoConsulted).toEqual([
      { key: 'C2', type: 'confluence', title: 'Two', url: 'https://x/c2' },
      { key: 'G1', type: 'github', title: 'a.js', url: 'https://x/g1' },
      { type: 'github', title: 'Hit', url: 'https://x/hit' },
    ]);
  });

  it('does not repeat a link that is cited, listed or found twice', () => {
    const sources = registry();
    sources.addCandidate({ type: 'confluence', title: 'Cited page', url: 'https://x/c1' });
    sources.addCandidate({ type: 'confluence', title: 'Uncited page', url: 'https://x/c2' });
    sources.addCandidate({ type: 'github', title: 'New', url: 'https://x/new' });

    const { alsoConsulted } = assembleAnswer({ answer: 'x [C1]', role: ROLE, registry: sources });

    expect(alsoConsulted.map(({ url }) => url)).toEqual([
      'https://x/c2',
      'https://x/g1',
      'https://x/new',
    ]);
    expect(alsoConsulted[0]).toMatchObject({ key: 'C2', title: 'Two' });
  });

  it('keeps at most ten', () => {
    const sources = createCitationRegistry();
    for (let index = 0; index < 8; index += 1) {
      sources.register(confluenceSource({ id: String(index), url: `https://x/c${index}` }));
    }
    for (let index = 0; index < 8; index += 1) {
      sources.addCandidate({ type: 'github', title: `Hit ${index}`, url: `https://x/h${index}` });
    }

    const { alsoConsulted } = assembleAnswer({ answer: 'nothing', role: ROLE, registry: sources });

    expect(MAX_ALSO_CONSULTED).toBe(10);
    expect(alsoConsulted).toHaveLength(10);
    expect(alsoConsulted.slice(0, 8).every(({ key }) => key !== undefined)).toBe(true);
    expect(alsoConsulted.slice(8).map(({ title }) => title)).toEqual(['Hit 0', 'Hit 1']);
  });

  it('is empty when nothing was fetched or found', () => {
    const result = assembleAnswer({ answer: 'x', role: ROLE, registry: createCitationRegistry() });

    expect(result).toMatchObject({
      sources: [],
      alsoConsulted: [],
      invalidKeys: [],
      uncitedSourceKeys: [],
    });
  });
});
