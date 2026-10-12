// @ts-check
import { describe, expect, it } from 'vitest';
import { casesByModel, formatModelSwitches, groupModelSwitches } from '../../src/eval/switches.js';
import { formatSummary } from '../../src/eval/summary.js';
import { summarise } from '../../src/eval/summarise.js';
import { makeHeader, makeScore } from '../helpers/eval.js';

const RATE_LIMIT = {
  reason: 'rate_limit_auto_switch',
  source: 'automatic',
  from: 'gpt-6-luna',
  to: 'mai-code-1.1-flash',
};

/**
 * A case as it ran.
 * @param {string} id - The case id.
 * @param {Record<string, unknown> | undefined} result - The stored answer.
 * @returns {import('../../src/eval/run.js').RunEntry} The entry.
 */
function entry(id, result) {
  return {
    id,
    role: 'developer',
    question: 'Q?',
    tags: [],
    reference: 'R',
    score: makeScore({ id }),
    result,
    error: undefined,
  };
}

describe('groupModelSwitches', () => {
  it('groups changes with the same reason and models, listing each case once', () => {
    const groups = groupModelSwitches([
      entry('a', { modelChanges: [RATE_LIMIT, RATE_LIMIT] }),
      entry('b', { modelChanges: [RATE_LIMIT] }),
      entry('c', { modelChanges: [{ ...RATE_LIMIT, reason: 'refusal_fallback' }] }),
    ]);

    expect(groups).toEqual([
      { ...RATE_LIMIT, cases: ['a', 'b'] },
      { ...RATE_LIMIT, reason: 'refusal_fallback', cases: ['c'] },
    ]);
  });

  it('puts the same number of cases in alphabetical order of reason', () => {
    const groups = groupModelSwitches([
      entry('a', { modelChanges: [{ ...RATE_LIMIT, reason: 'zeta' }] }),
      entry('b', { modelChanges: [{ ...RATE_LIMIT, reason: 'alpha' }] }),
    ]);

    expect(groups.map(({ reason }) => reason)).toEqual(['alpha', 'zeta']);
  });

  it('says unknown for what the runtime did not name', () => {
    const [group] = groupModelSwitches([entry('a', { modelChanges: [{ to: 'x' }] })]);

    expect(group).toMatchObject({ reason: 'unknown', source: 'unknown', from: 'unknown', to: 'x' });
  });

  it('ignores answers from before changes were recorded, failed cases and malformed changes', () => {
    const groups = groupModelSwitches([
      entry('a', {}),
      entry('b', undefined),
      entry('c', { modelChanges: 'none' }),
      entry('d', { modelChanges: [null, 'text', { reason: 'x' }] }),
    ]);

    expect(groups).toEqual([]);
  });
});

describe('casesByModel', () => {
  it('lists the cases each model answered, the busiest model first', () => {
    const rows = casesByModel([
      entry('a', { model: 'm1' }),
      entry('b', { model: 'm2' }),
      entry('c', { model: 'm2' }),
      entry('d', undefined),
      entry('e', { model: 7 }),
    ]);

    expect(rows).toEqual([
      { model: 'm2', cases: ['b', 'c'] },
      { model: 'unknown', cases: ['d', 'e'] },
      { model: 'm1', cases: ['a'] },
    ]);
  });

  it('puts models with the same number of cases in alphabetical order', () => {
    const rows = casesByModel([entry('a', { model: 'zz' }), entry('b', { model: 'aa' })]);

    expect(rows.map(({ model }) => model)).toEqual(['aa', 'zz']);
  });
});

describe('formatModelSwitches', () => {
  it('shows who answered and each kind of change with its reason', () => {
    const text = formatModelSwitches([
      entry('a', { model: 'mai-code-1.1-flash', modelChanges: [RATE_LIMIT] }),
      entry('b', { model: 'gpt-6-luna', modelChanges: [] }),
    ]);

    expect(text).toContain('| mai-code-1.1-flash | 1 | a |');
    expect(text).toContain(
      '| rate_limit_auto_switch | automatic | gpt-6-luna | mai-code-1.1-flash | 1 | a |',
    );
  });

  it('says so when the model never changed', () => {
    const text = formatModelSwitches([entry('a', { model: 'gpt-6-luna' })]);

    expect(text).toContain('did not change the model in any case');
  });
});

describe('formatSummary models section', () => {
  const summary = summarise([makeScore()]);

  it('is included when the cases are given', () => {
    const text = formatSummary({
      run: makeHeader(),
      summary,
      entries: [entry('a', { model: 'gpt-x', modelChanges: [RATE_LIMIT] })],
    });

    expect(text).toContain('## Models');
    expect(text).toContain('rate_limit_auto_switch');
  });

  it('is left out when they are not', () => {
    expect(formatSummary({ run: makeHeader(), summary })).not.toContain('## Models');
  });
});
