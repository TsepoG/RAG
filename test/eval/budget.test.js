// @ts-check
import { describe, expect, it } from 'vitest';
import { createRequestGuard, estimateRequests } from '../../src/eval/budget.js';
import { EvalError } from '../../src/errors/index.js';
import { makeCase } from '../helpers/eval.js';

const ROLES = new Map([
  ['developer', { depth: 3 }],
  ['qa', { depth: 2 }],
  ['product_owner', { depth: 1 }],
]);

describe('estimateRequests', () => {
  it('is one request per case when no case is likely to be rewritten', () => {
    const cases = [makeCase({ id: 'a' }), makeCase({ id: 'b', role: 'qa' })];

    expect(estimateRequests(cases, ROLES)).toEqual({ cases: 2, expected: 2, worstCase: 6 });
  });

  it('adds one request for an answered case for a plain-spoken role', () => {
    const cases = [makeCase({ id: 'a', role: 'product_owner' }), makeCase({ id: 'b' })];

    expect(estimateRequests(cases, ROLES).expected).toBe(3);
  });

  it('adds one request for a style trap, whatever the role', () => {
    const cases = [makeCase({ id: 'a', role: 'qa', tags: ['style-trap'] })];

    expect(estimateRequests(cases, ROLES).expected).toBe(2);
  });

  it('adds one request, for the report, for a case that is not expected to be answered, but no rewrite', () => {
    const cases = [
      makeCase({
        id: 'a',
        role: 'product_owner',
        tags: ['style-trap'],
        expect: { status: 'not_found', reference: 'r' },
      }),
    ];

    expect(estimateRequests(cases, ROLES).expected).toBe(2);
  });

  it('counts a case once, though it is both plain-spoken and a style trap', () => {
    const cases = [makeCase({ role: 'product_owner', tags: ['style-trap'] })];

    expect(estimateRequests(cases, ROLES).expected).toBe(2);
  });

  it('counts a role it does not know as not likely to be rewritten', () => {
    expect(estimateRequests([makeCase({ role: 'stranger' })], ROLES).expected).toBe(1);
  });

  it('is zero for no cases', () => {
    expect(estimateRequests([], ROLES)).toEqual({ cases: 0, expected: 0, worstCase: 0 });
  });

  it('never expects more than the worst case', () => {
    const cases = Array.from({ length: 5 }, (_, index) =>
      makeCase({ id: `c${index}`, role: 'product_owner', tags: ['style-trap'] }),
    );

    const { expected, worstCase } = estimateRequests(cases, ROLES);

    expect(expected).toBeLessThanOrEqual(worstCase);
  });
});

describe('createRequestGuard', () => {
  it('lets every case start when there is no limit', () => {
    const guard = createRequestGuard(undefined);

    for (let index = 0; index < 100; index += 1) {
      expect(guard.canStart()).toBe(true);
      guard.record({ rewritten: true });
    }

    expect(guard.report()).toEqual({
      limit: undefined,
      used: 200,
      casesRun: 100,
      stoppedEarly: false,
    });
  });

  it('counts one request for a case, and two for a case that was rewritten', () => {
    const guard = createRequestGuard(10);

    guard.record({});
    guard.record({ rewritten: true });

    expect(guard.report().used).toBe(3);
  });

  it('counts a request more when the confidence report was asked for again', () => {
    const guard = createRequestGuard(10);

    guard.record({ metaRepaired: true });
    guard.record({ metaRepaired: true, rewritten: true });

    expect(guard.report().used).toBe(5);
  });

  it('counts a request more when the report was asked for again and not got', () => {
    const guard = createRequestGuard(10);

    guard.record({ metaRepairRejected: true });

    expect(guard.report().used).toBe(2);
  });

  it('counts two requests for a rewrite that was tried and not used', () => {
    const guard = createRequestGuard(10);

    guard.record({ rewriteRejected: true });

    expect(guard.report().used).toBe(2);
  });

  it('stops before a case once the limit is reached, and says how many ran', () => {
    const guard = createRequestGuard(3);
    let ran = 0;

    while (guard.canStart()) {
      guard.record({});
      ran += 1;
    }

    expect(ran).toBe(3);
    expect(guard.report()).toEqual({ limit: 3, used: 3, casesRun: 3, stoppedEarly: true });
  });

  it('can go one request over when the last case is rewritten, because a case that started finishes', () => {
    const guard = createRequestGuard(3);

    guard.record({});
    guard.record({});
    expect(guard.canStart()).toBe(true);
    guard.record({ rewritten: true });

    expect(guard.report().used).toBe(4);
    expect(guard.canStart()).toBe(false);
  });

  it('keeps saying no once it has stopped', () => {
    const guard = createRequestGuard(1);
    guard.record({});

    expect(guard.canStart()).toBe(false);
    expect(guard.canStart()).toBe(false);
  });

  it('does not say it stopped early when the limit was reached by the last case', () => {
    const guard = createRequestGuard(2);
    guard.record({});
    guard.record({});

    expect(guard.report().stoppedEarly).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the limit %s', (limit) => {
    expect(() => createRequestGuard(limit)).toThrow(EvalError);
  });
});
