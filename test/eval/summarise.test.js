// @ts-check
import { describe, expect, it } from 'vitest';
import { compareRuns } from '../../src/eval/compare.js';
import { percentile, summarise } from '../../src/eval/summarise.js';
import { makeScore } from '../helpers/eval.js';

describe('percentile', () => {
  it.each([
    [[1, 2, 3, 4], 0.5, 2],
    [[1, 2, 3, 4, 5], 0.5, 3],
    [[10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.95, 100],
    [[5], 0.95, 5],
    [[3, 1, 2], 0.5, 2],
  ])('gives the nearest-rank percentile of %j at %f: %i', (values, share, expected) => {
    expect(percentile(values, share)).toBe(expected);
  });

  it('gives nothing for no values', () => {
    expect(percentile([], 0.5)).toBeUndefined();
  });

  it('does not change the numbers it is given', () => {
    const values = [3, 1, 2];

    percentile(values, 0.5);

    expect(values).toEqual([3, 1, 2]);
  });
});

describe('summarise: an empty run', () => {
  it('gives zero counts and no shares, not NaN', () => {
    const summary = summarise([]);

    expect(summary).toMatchObject({ cases: 0, errors: 0, callBudgetHits: 0, citationCases: 0 });
    expect(summary.statusAccuracy).toEqual({ count: 0, of: 0, rate: undefined });
    expect(summary.citationRecall).toBeUndefined();
    expect(summary.inferredShare).toBeUndefined();
    expect(summary.latencyMs).toEqual({ p50: undefined, p95: undefined });
    expect(summary.confusion).toEqual({});
    expect(summary.failures).toEqual({});
  });
});

describe('summarise: status and honesty', () => {
  it('works out status accuracy and the share that passed', () => {
    const summary = summarise([
      makeScore({ id: 'a' }),
      makeScore({ id: 'b' }),
      makeScore({ id: 'c', statusMatch: false, passed: false }),
      makeScore({ id: 'd' }),
    ]);

    expect(summary.statusAccuracy).toEqual({ count: 3, of: 4, rate: 0.75 });
    expect(summary.passed).toEqual({ count: 3, of: 4, rate: 0.75 });
  });

  it('reports declining and honesty only over the cases they apply to', () => {
    const summary = summarise([
      makeScore({ id: 'a', declinedAppropriately: true, honest: true }),
      makeScore({ id: 'b', declinedAppropriately: false, honest: false }),
      makeScore({ id: 'c' }),
    ]);

    expect(summary.declinedAppropriately).toEqual({ count: 1, of: 2, rate: 0.5 });
    expect(summary.honest).toEqual({ count: 1, of: 2, rate: 0.5 });
  });

  it('lists the cases that were dishonest, were not declined or got the wrong status', () => {
    const { failures } = summarise([
      makeScore({ id: 'a', statusMatch: false, declinedAppropriately: false, honest: false }),
      makeScore({ id: 'b' }),
    ]);

    expect(failures).toMatchObject({ wrongStatus: ['a'], notDeclined: ['a'], dishonest: ['a'] });
  });
});

describe('summarise: citations and checks', () => {
  it('averages citation recall over the cases that expect sources', () => {
    const summary = summarise([
      makeScore({ id: 'a', citationRecall: 1 }),
      makeScore({ id: 'b', citationRecall: 0.5, missedSources: 1 }),
      makeScore({ id: 'c' }),
    ]);

    expect(summary.citationRecall).toBe(0.75);
    expect(summary.citationCases).toBe(2);
    expect(summary.failures.missedSources).toEqual(['b']);
  });

  it('counts the cases that cited a forbidden source', () => {
    const summary = summarise([makeScore({ id: 'a', mustNotCiteHits: 2 }), makeScore({ id: 'b' })]);

    expect(summary.mustNotCiteViolations).toEqual({ count: 1, of: 2, rate: 0.5 });
    expect(summary.failures.forbiddenSource).toEqual(['a']);
  });

  it('reports the confidence limit only over the cases that set one', () => {
    const summary = summarise([
      makeScore({ id: 'a', maxConfidenceRespected: true }),
      makeScore({ id: 'b', maxConfidenceRespected: false }),
      makeScore({ id: 'c' }),
    ]);

    expect(summary.maxConfidenceRespected).toEqual({ count: 1, of: 2, rate: 0.5 });
    expect(summary.failures.tooConfident).toEqual(['b']);
  });

  it('counts plain-style violations over every case', () => {
    const summary = summarise([
      makeScore({ id: 'a', plainStyleViolations: 2 }),
      makeScore({ id: 'b' }),
    ]);

    expect(summary.plainStyleViolations).toEqual({ count: 1, of: 2, rate: 0.5 });
    expect(summary.failures.plainStyle).toEqual(['a']);
  });

  it('counts the reports that were got by asking again', () => {
    const summary = summarise([makeScore({ metaRepaired: true }), makeScore({ id: 'b' })]);

    expect(summary.metaRepaired).toEqual({ count: 1, of: 2, rate: 0.5 });
  });

  it('counts the reports that were asked for again and not got', () => {
    const summary = summarise([makeScore({ metaRepairRejected: true }), makeScore({ id: 'b' })]);

    expect(summary.metaRepairRejected).toEqual({ count: 1, of: 2, rate: 0.5 });
  });

  it('counts meta errors, invalid keys and uncited sentences', () => {
    const summary = summarise([
      makeScore({ id: 'a', metaError: true, invalidKeys: 1, uncitedSentences: 3 }),
      makeScore({ id: 'b' }),
    ]);

    expect(summary.metaErrors.count).toBe(1);
    expect(summary.invalidKeys.count).toBe(1);
    expect(summary.uncitedSentences.count).toBe(1);
    expect(summary.failures).toMatchObject({
      metaError: ['a'],
      invalidKeys: ['a'],
      uncitedSentences: ['a'],
    });
  });

  it('averages the inferred share', () => {
    const summary = summarise([
      makeScore({ id: 'a', inferredShare: 0.5 }),
      makeScore({ id: 'b', inferredShare: 1 }),
      makeScore({ id: 'c' }),
    ]);

    expect(summary.inferredShare).toBe(0.75);
  });

  it('counts rewrites, rewrites that were not used, and the cases that hit the call limit', () => {
    const summary = summarise([
      makeScore({ id: 'a', rewritten: true }),
      makeScore({ id: 'b', rewriteRejected: true, callBudgetHit: true }),
      makeScore({ id: 'c' }),
      makeScore({ id: 'd', callBudgetHit: true }),
    ]);

    expect(summary.rewritten).toEqual({ count: 1, of: 4, rate: 0.25 });
    expect(summary.rewriteRejected).toEqual({ count: 1, of: 4, rate: 0.25 });
    expect(summary.callBudgetHits).toBe(2);
  });
});

describe('summarise: errors, time, confidence and the matrix', () => {
  it('counts the questions that failed, and lists them', () => {
    const summary = summarise([
      makeScore({ id: 'a', status: 'error', statusMatch: false }),
      makeScore({ id: 'b' }),
    ]);

    expect(summary.errors).toBe(1);
    expect(summary.failures.error).toEqual(['a']);
  });

  it('works out the median and 95th percentile time', () => {
    const scores = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((latencyMs, index) =>
      makeScore({ id: `c${index}`, latencyMs }),
    );

    expect(summarise(scores).latencyMs).toEqual({ p50: 500, p95: 1000 });
  });

  it('counts how many answers claimed each confidence, and how many claimed none', () => {
    const summary = summarise([
      makeScore({ id: 'a', confidence: 'high' }),
      makeScore({ id: 'b', confidence: 'high' }),
      makeScore({ id: 'c', confidence: 'medium' }),
      makeScore({ id: 'd', confidence: 'low' }),
      makeScore({ id: 'e', confidence: null }),
    ]);

    expect(summary.confidence).toEqual({ high: 2, medium: 1, low: 1, none: 1 });
  });

  it('builds a matrix of the expected status against the actual one', () => {
    const summary = summarise([
      makeScore({ id: 'a', expectedStatus: 'answered', status: 'answered' }),
      makeScore({ id: 'b', expectedStatus: 'answered', status: 'not_found' }),
      makeScore({ id: 'c', expectedStatus: 'out_of_scope', status: 'answered' }),
      makeScore({ id: 'd', expectedStatus: 'out_of_scope', status: 'answered' }),
    ]);

    expect(summary.confusion).toEqual({
      answered: { answered: 1, not_found: 1 },
      out_of_scope: { answered: 2 },
    });
  });

  it('leaves out of the failures every check that passed', () => {
    expect(summarise([makeScore()]).failures).toEqual({});
  });
});

describe('compareRuns', () => {
  it('finds no change between two identical runs', () => {
    const run = [makeScore({ id: 'a' }), makeScore({ id: 'b' })];

    expect(compareRuns(run, run)).toEqual({
      compared: 2,
      changed: [],
      confidenceChanged: 0,
      passedBefore: 2,
      passedAfter: 2,
      onlyBefore: [],
      onlyAfter: [],
    });
  });

  it('lists a case whose status changed, with both outcomes', () => {
    const before = [makeScore({ id: 'a', status: 'answered' })];
    const after = [
      makeScore({
        id: 'a',
        status: 'not_found',
        statusMatch: false,
        passed: false,
        confidence: null,
      }),
    ];

    const { changed } = compareRuns(before, after);

    expect(changed).toEqual([
      {
        id: 'a',
        before: { status: 'answered', passed: true, confidence: 'medium' },
        after: { status: 'not_found', passed: false, confidence: null },
      },
    ]);
  });

  it('lists a case that kept its status but stopped passing', () => {
    const { changed } = compareRuns(
      [makeScore({ id: 'a' })],
      [makeScore({ id: 'a', passed: false, mustNotCiteHits: 1 })],
    );

    expect(changed.map(({ id }) => id)).toEqual(['a']);
  });

  it('counts a change of confidence on its own, without calling it a changed outcome', () => {
    const comparison = compareRuns(
      [makeScore({ id: 'a', confidence: 'high' })],
      [makeScore({ id: 'a', confidence: 'medium' })],
    );

    expect(comparison.confidenceChanged).toBe(1);
    expect(comparison.changed).toEqual([]);
  });

  it('counts how many passed in each run, among the cases in both', () => {
    const comparison = compareRuns(
      [
        makeScore({ id: 'a' }),
        makeScore({ id: 'b', passed: false }),
        makeScore({ id: 'only-first' }),
      ],
      [makeScore({ id: 'a' }), makeScore({ id: 'b' }), makeScore({ id: 'only-second' })],
    );

    expect(comparison).toMatchObject({ compared: 2, passedBefore: 1, passedAfter: 2 });
  });

  it('lists the cases that are in only one run', () => {
    const comparison = compareRuns(
      [makeScore({ id: 'a' }), makeScore({ id: 'x' })],
      [makeScore({ id: 'a' }), makeScore({ id: 'y' })],
    );

    expect(comparison.onlyBefore).toEqual(['x']);
    expect(comparison.onlyAfter).toEqual(['y']);
  });

  it('copes with empty runs', () => {
    expect(compareRuns([], [])).toMatchObject({ compared: 0, changed: [] });
  });
});
