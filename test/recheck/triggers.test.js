// @ts-check
import { describe, expect, it } from 'vitest';
import { blobFingerprint, pageFingerprint } from '../../src/citations/index.js';
import { selectForAutoRecheck } from '../../src/recheck/index.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

const MINUTE = 60_000;
const NOW = 100 * MINUTE;

/**
 * A source as the conversation registry keeps it.
 * @param {string} key - The key.
 * @param {{ turn?: number, ageMinutes?: number, changed?: boolean, fingerprint?: string | null }} [options] - How it was fetched.
 * @returns {import('../../src/citations/index.js').RegisteredSource} The source.
 */
function registered(key, { turn = 2, ageMinutes = 0, changed = false, fingerprint } = {}) {
  const base = key.startsWith('C') ? confluenceSource({ id: key }) : githubSource({ path: key });
  const usual = key.startsWith('C') ? pageFingerprint(1) : blobFingerprint(key);
  const print = fingerprint === undefined ? usual : (fingerprint ?? undefined);
  return {
    ...base,
    key,
    fetchedInTurn: turn,
    fetchedAt: NOW - ageMinutes * MINUTE,
    changed,
    ...(print === undefined ? {} : { fingerprint: print }),
  };
}

/**
 * Chooses with the usual times, changing only what a test cares about.
 * @param {Partial<Parameters<typeof selectForAutoRecheck>[0]>} input - What differs.
 * @returns {string[]} The keys chosen.
 */
function choose(input) {
  return selectForAutoRecheck({
    turnSources: [],
    conversationSources: [],
    turn: 2,
    isLastTurn: false,
    now: NOW,
    afterMinutes: 15,
    lastCheckedAt: () => undefined,
    ...input,
  }).map(({ key }) => key);
}

describe('after a turn', () => {
  it('checks a source an earlier turn fetched', () => {
    expect(choose({ turnSources: [registered('C1', { turn: 1 })] })).toEqual(['C1']);
  });

  it('leaves a source this turn just fetched', () => {
    expect(choose({ turnSources: [registered('C1', { turn: 2 })] })).toEqual([]);
  });

  it('checks a source fetched this turn once it is older than the time allowed', () => {
    const sources = [registered('C1', { ageMinutes: 14 }), registered('C2', { ageMinutes: 15 })];

    expect(choose({ turnSources: sources })).toEqual(['C2']);
  });

  it('skips a source that was checked within the time allowed, and takes it again after', () => {
    const sources = [registered('C1', { turn: 1 })];

    expect(choose({ turnSources: sources, lastCheckedAt: () => NOW - 14 * MINUTE })).toEqual([]);
    expect(choose({ turnSources: sources, lastCheckedAt: () => NOW - 15 * MINUTE })).toEqual([
      'C1',
    ]);
  });

  it('skips what cannot be compared: no fingerprint, or already replaced by a newer state', () => {
    const sources = [
      registered('G1', { turn: 1, fingerprint: null }),
      registered('G2', { turn: 1, changed: true }),
      registered('G3', { turn: 1 }),
    ];

    expect(choose({ turnSources: sources })).toEqual(['G3']);
  });

  it('only looks at what the turn cited, not the rest of the conversation', () => {
    const everything = [registered('C1', { turn: 1 }), registered('C2', { turn: 1 })];

    expect(choose({ turnSources: [everything[1]], conversationSources: everything })).toEqual([
      'C2',
    ]);
  });

  it('treats a source with no record of when it was fetched as just fetched', () => {
    const { fetchedInTurn, fetchedAt, ...bare } = registered('C1');

    expect(choose({ turnSources: [bare] })).toEqual([]);
    expect(fetchedInTurn).toBe(2);
    expect(fetchedAt).toBe(NOW);
  });
});

describe('at the last turn', () => {
  it('checks every source cited anywhere in the conversation, whatever its age or turn', () => {
    const everything = [
      registered('C1', { turn: 1 }),
      registered('G1', { turn: 2, ageMinutes: 0 }),
      registered('G2', { turn: 2, changed: true }),
    ];

    expect(choose({ isLastTurn: true, conversationSources: everything })).toEqual(['C1', 'G1']);
  });

  it('still skips a source checked a moment ago', () => {
    const everything = [registered('C1', { turn: 1 }), registered('G1', { turn: 1 })];

    expect(
      choose({
        isLastTurn: true,
        conversationSources: everything,
        lastCheckedAt: (key) => (key === 'C1' ? NOW - MINUTE : undefined),
      }),
    ).toEqual(['G1']);
  });
});
