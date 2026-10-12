// @ts-check
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { buildCalibration, MIN_SAMPLE } from '../../src/eval/calibration.js';
import { parseFeedbackLines, summariseFeedback } from '../../src/eval/feedback.js';
import { buildReport, diffRunInfo } from '../../src/eval/report.js';
import { resolveRunFolder } from '../../src/eval/results.js';
import { summarise } from '../../src/eval/summarise.js';
import { evaluateTargets } from '../../src/eval/targets.js';
import { makeHeader, makeScore } from '../helpers/eval.js';

/**
 * Judgements for some cases.
 * @param {Record<string, string>} verdicts - Verdict by case id.
 * @returns {Map<string, { verdict: any, note: string }>} The judgements.
 */
function judged(verdicts) {
  return new Map(Object.entries(verdicts).map(([id, verdict]) => [id, { verdict, note: '' }]));
}

/**
 * Several answered cases at one confidence level.
 * @param {string} prefix - Id prefix.
 * @param {number} count - How many.
 * @param {'high' | 'medium' | 'low'} confidence - The level they claimed.
 * @returns {import('../../src/eval/score.js').CaseScore[]} The scores.
 */
function answers(prefix, count, confidence) {
  return Array.from({ length: count }, (_, index) =>
    makeScore({ id: `${prefix}${index}`, confidence }),
  );
}

describe('buildCalibration', () => {
  it('works out correctness, counting a partly correct answer as half', () => {
    const scores = answers('a', 4, 'high');
    const { overall } = buildCalibration(
      scores,
      judged({ a0: 'correct', a1: 'correct', a2: 'partial', a3: 'wrong' }),
    );

    expect(overall).toMatchObject({ n: 4, correct: 2, partial: 1, wrong: 1, rate: 0.625 });
  });

  it('splits correctness by the confidence claimed', () => {
    const scores = [
      ...answers('h', 2, 'high'),
      ...answers('m', 2, 'medium'),
      ...answers('l', 1, 'low'),
    ];
    const { levels } = buildCalibration(
      scores,
      judged({ h0: 'correct', h1: 'correct', m0: 'wrong', m1: 'correct', l0: 'wrong' }),
    );

    expect(levels.high).toMatchObject({ n: 2, rate: 1 });
    expect(levels.medium).toMatchObject({ n: 2, rate: 0.5 });
    expect(levels.low).toMatchObject({ n: 1, rate: 0 });
  });

  it('calls a level with fewer than five answers a small sample', () => {
    const scores = answers('h', MIN_SAMPLE + 1, 'high');
    const verdicts = Object.fromEntries(scores.map(({ id }) => [id, 'correct']));

    const few = buildCalibration(scores.slice(0, MIN_SAMPLE - 1), judged(verdicts)).levels.high;
    const enough = buildCalibration(scores.slice(0, MIN_SAMPLE), judged(verdicts)).levels.high;

    expect(few.small).toBe(true);
    expect(enough.small).toBe(false);
  });

  it('has no rate for a level where nothing was judged', () => {
    const { levels } = buildCalibration(answers('h', 2, 'high'), judged({}));

    expect(levels.high).toMatchObject({ n: 0, rate: undefined });
  });

  it('counts only cases the assistant answered', () => {
    const scores = [
      makeScore({ id: 'a', status: 'answered' }),
      makeScore({ id: 'n', status: 'not_found', confidence: null }),
    ];

    const calibration = buildCalibration(scores, judged({ a: 'correct', n: 'wrong' }));

    expect(calibration).toMatchObject({ answered: 1, judged: 1 });
    expect(calibration.overall.n).toBe(1);
  });

  it('lists the answered cases that still have no verdict', () => {
    const calibration = buildCalibration(answers('a', 3, 'high'), judged({ a0: 'correct' }));

    expect(calibration.unjudged).toEqual(['a1', 'a2']);
    expect(calibration.judged).toBe(1);
  });
});

describe('evaluateTargets', () => {
  /**
   * Checks a set of scores against the targets.
   * @param {import('../../src/eval/score.js').CaseScore[]} scores - The scores.
   * @param {Record<string, string>} [verdicts] - The verdicts.
   * @returns {Record<string, { target: string, actual: string, result: string }>} Each row by name.
   */
  function rows(scores, verdicts = {}) {
    const list = evaluateTargets({
      summary: summarise(scores),
      calibration: buildCalibration(scores, judged(verdicts)),
    });
    return Object.fromEntries(list.map((row) => [row.name, row]));
  }

  it('marks every target met for a clean run', () => {
    const scores = answers('h', 5, 'high').map((one) => ({ ...one, citationRecall: 1 }));
    const verdicts = Object.fromEntries(scores.map(({ id }) => [id, 'correct']));

    const result = Object.values(rows(scores, verdicts)).map(({ result: outcome }) => outcome);

    expect(result).toContain('met');
    expect(result).not.toContain('not met');
  });

  it('marks a status accuracy below 85% as not met', () => {
    const scores = [
      ...Array.from({ length: 4 }, (_, index) => makeScore({ id: `ok${index}` })),
      makeScore({ id: 'bad', statusMatch: false }),
    ];

    expect(rows(scores)['Status exactly as expected']).toMatchObject({
      actual: '80%',
      result: 'not met',
    });
  });

  it('marks citation recall against 70%', () => {
    const pass = rows([makeScore({ citationRecall: 0.7 })]);
    const fail = rows([makeScore({ citationRecall: 0.6 })]);

    expect(pass['Citation recall'].result).toBe('met');
    expect(fail['Citation recall'].result).toBe('not met');
  });

  it('says there is not enough data for citation recall when no case expects sources', () => {
    expect(rows([makeScore()])['Citation recall'].result).toBe('not enough data');
  });

  it('marks correctness against 80%, and says when there are no verdicts', () => {
    const scores = answers('a', 5, 'medium');

    expect(rows(scores)['Answered cases that are correct']).toMatchObject({
      actual: 'no verdicts yet',
      result: 'not enough data',
    });
    expect(
      rows(scores, { a0: 'correct', a1: 'correct', a2: 'correct', a3: 'correct', a4: 'wrong' })[
        'Answered cases that are correct'
      ].result,
    ).toBe('met');
    expect(
      rows(scores, { a0: 'correct', a1: 'correct', a2: 'wrong', a3: 'wrong', a4: 'wrong' })[
        'Answered cases that are correct'
      ].result,
    ).toBe('not met');
  });

  it('does not judge `high` answers from fewer than five, and says how many there were', () => {
    const scores = answers('h', 3, 'high');

    const row = rows(scores, { h0: 'wrong', h1: 'wrong', h2: 'wrong' })[
      '`high` answers that are correct'
    ];

    expect(row).toMatchObject({
      result: 'not enough data',
      actual: 'only 3 judged (fewer than 5)',
    });
  });

  it('marks `high` answers against 90% once there are five', () => {
    const scores = answers('h', 5, 'high');

    const row = rows(scores, {
      h0: 'correct',
      h1: 'correct',
      h2: 'correct',
      h3: 'correct',
      h4: 'wrong',
    })['`high` answers that are correct'];

    expect(row).toMatchObject({ actual: '80%', result: 'not met' });
  });

  it('marks honesty on cases to decline against 80%', () => {
    const scores = [
      makeScore({ id: 'a', honest: true }),
      makeScore({ id: 'b', honest: true }),
      makeScore({ id: 'c', honest: false }),
    ];

    expect(rows(scores)['Cases to decline handled honestly']).toMatchObject({
      actual: '67%',
      result: 'not met',
    });
  });

  it('wants no style problem for a depth 1 role', () => {
    expect(rows([makeScore()])['Style problems left for a depth 1 role']).toMatchObject({
      actual: '0',
      result: 'met',
    });
    expect(
      rows([makeScore({ plainStyleViolations: 1 })])['Style problems left for a depth 1 role']
        .result,
    ).toBe('not met');
  });

  it('says there is not enough data for style or the meta report on an empty run', () => {
    const empty = rows([]);

    expect(empty['Style problems left for a depth 1 role']).toMatchObject({
      actual: 'n/a',
      result: 'not enough data',
    });
    expect(empty['Answers with no confidence report'].result).toBe('not enough data');
  });

  it('allows up to 10% of answers to lack the confidence report', () => {
    const ten = [
      ...Array.from({ length: 9 }, (_, i) => makeScore({ id: `a${i}` })),
      makeScore({ id: 'b', metaError: true }),
    ];
    const more = [
      ...Array.from({ length: 4 }, (_, i) => makeScore({ id: `a${i}` })),
      makeScore({ id: 'b', metaError: true }),
    ];

    expect(rows(ten)['Answers with no confidence report'].result).toBe('met');
    expect(rows(more)['Answers with no confidence report'].result).toBe('not met');
  });
});

describe('summariseFeedback and parseFeedbackLines', () => {
  /**
   * A feedback line.
   * @param {Record<string, unknown>} [changes] - Fields to replace.
   * @returns {string} One JSON line.
   */
  function line(changes = {}) {
    return JSON.stringify({
      timestamp: '2026-10-11T16:15:20.121Z',
      question: 'How long?',
      role: 'developer',
      detailLevel: 'default',
      status: 'answered',
      confidence: 'medium',
      citedKeys: ['C1'],
      rating: 'up',
      comment: null,
      wrongSourceKey: null,
      model: 'gpt-x',
      ...changes,
    });
  }

  it('reads each line, and skips and counts the ones that cannot be read', () => {
    const text = [
      line(),
      '{broken',
      line({ rating: 'sideways' }),
      '',
      line({ rating: 'down' }),
    ].join('\n');

    const { records, skipped } = parseFeedbackLines(text);

    expect(records).toHaveLength(2);
    expect(skipped).toBe(2);
  });

  it('reads nothing from an empty file', () => {
    expect(parseFeedbackLines('')).toEqual({ records: [], skipped: 0 });
  });

  it('counts the votes, by role and by status', () => {
    const { records } = parseFeedbackLines(
      [
        line({ rating: 'up', role: 'qa' }),
        line({ rating: 'down', role: 'qa', status: 'not_found' }),
        line({ rating: 'down', role: 'developer' }),
      ].join('\n'),
    );

    const summary = summariseFeedback(records);

    expect(summary.votes).toEqual({ up: 1, down: 2 });
    expect(summary.upShare).toBeCloseTo(1 / 3);
    expect(summary.byRole).toEqual({ developer: { up: 0, down: 1 }, qa: { up: 1, down: 1 } });
    expect(summary.byStatus).toEqual({
      answered: { up: 1, down: 1 },
      not_found: { up: 0, down: 1 },
    });
  });

  it('counts the sources named as wrong and the comments', () => {
    const { records } = parseFeedbackLines(
      [
        line({ rating: 'down', wrongSourceKey: 'G2', comment: 'wrong file' }),
        line({ rating: 'down', wrongSourceKey: 'C1', comment: '' }),
        line({ rating: 'down', wrongSourceKey: 'G2' }),
      ].join('\n'),
    );

    const summary = summariseFeedback(records);

    expect(summary.wrongSources).toEqual({ C1: 1, G2: 2 });
    expect(summary.comments).toBe(1);
  });

  it('has no share when there is no feedback', () => {
    expect(summariseFeedback([])).toMatchObject({ total: 0, upShare: undefined, comments: 0 });
  });
});

describe('diffRunInfo', () => {
  it('finds nothing when the runs are tied to the same things', () => {
    expect(diffRunInfo(makeHeader(), makeHeader())).toEqual([]);
  });

  it('names each thing that differs, from and to', () => {
    const lines = diffRunInfo(
      makeHeader(),
      makeHeader({
        commit: 'def',
        dirty: true,
        model: 'gpt-y',
        basePromptHash: 'ffffffffffff',
        roles: { developer: 3, qa: 3, product_owner: 1 },
      }),
    );

    expect(lines).toEqual([
      'commit: abc123def456 → def',
      'working tree had uncommitted changes: false → true',
      'model asked for: gpt-x → gpt-y',
      'base prompt hash: 0123456789ab → ffffffffffff',
      'role developer version: 2 → 3',
      'role product_owner version: none → 1',
    ]);
  });

  it('flags a different set of models answering, since that changes results by itself', () => {
    const lines = diffRunInfo(
      makeHeader({ model: 'default', models: ['gpt-6-luna'] }),
      makeHeader({ model: 'default', models: ['gpt-6-luna', 'mai-code-1.1-flash'] }),
    );

    expect(lines).toEqual(['models that answered: gpt-6-luna → gpt-6-luna, mai-code-1.1-flash']);
  });

  it('notes a role that is no longer there', () => {
    expect(diffRunInfo(makeHeader(), makeHeader({ roles: { developer: 2 } }))).toEqual([
      'role qa version: 3 → none',
    ]);
  });
});

describe('buildReport', () => {
  const scores = [
    ...answers('h', 5, 'high'),
    makeScore({ id: 'm', confidence: 'medium' }),
    makeScore({
      id: 'o',
      expectedStatus: 'out_of_scope',
      status: 'not_found',
      confidence: null,
      statusMatch: false,
      passed: false,
      declinedAppropriately: true,
      honest: true,
    }),
  ];
  const verdicts = judged({
    h0: 'correct',
    h1: 'correct',
    h2: 'correct',
    h3: 'partial',
    h4: 'wrong',
    m: 'correct',
  });

  /**
   * Builds a report.
   * @param {Partial<import('../../src/eval/report.js').ReportInput>} [changes] - Fields to replace.
   * @returns {string} The report.
   */
  function report(changes = {}) {
    return buildReport({
      header: makeHeader(),
      scores,
      judgements: verdicts,
      review: { blank: [], missing: [] },
      feedback: undefined,
      previous: undefined,
      ...changes,
    });
  }

  it('shows what the run was tied to, the targets, and the calibration', () => {
    const text = report();

    expect(text).toContain('# Eval report');
    expect(text).toContain('abc123def456');
    expect(text).toContain('## MVP targets');
    expect(text).toContain('| Status exactly as expected | at least 85% |');
    expect(text).toContain('## Correctness and calibration');
    expect(text).toContain('| high | 5 | 3 / 1 / 1 | 70% |');
  });

  it('labels a level with few answers as a small sample', () => {
    expect(report()).toContain('small sample (1): no conclusion');
  });

  it('says how many answered cases have a verdict, and which are still to judge', () => {
    const text = report({ judgements: judged({ h0: 'correct' }) });

    expect(text).toContain('1 of 6 answered cases have a verdict');
    expect(text).toContain('Still to judge: h1, h2, h3, h4, m.');
  });

  it('says so when there is no review sheet, or the sheet has gaps', () => {
    expect(report({ review: undefined })).toContain('There is no review sheet yet');
    expect(report({ review: { blank: ['x'], missing: ['y'] } })).toContain(
      'Cases missing from the sheet: y. Rows with no verdict: x.',
    );
  });

  it('explains the difference between declining and the exact status', () => {
    const text = report();

    expect(text).toContain('Declined when it should (not_found or out_of_scope, either): 100%');
    expect(text).toContain(
      'a case that expected out_of_scope and got not_found is right in the first and wrong in the second',
    );
  });

  it('includes every automatic measure, the matrix and the failed checks', () => {
    const text = report();

    expect(text).toContain('## Automatic results');
    expect(text).toContain('| Citation recall |');
    expect(text).toContain('### Expected against actual status');
    expect(text).toContain('### Failed checks');
  });

  it('compares with an earlier run, naming what differs and the cases that changed', () => {
    const before = scores.map((one) =>
      one.id === 'm' ? { ...one, status: 'not_found', passed: false, statusMatch: false } : one,
    );

    const text = report({
      previous: {
        header: makeHeader({ commit: 'old', roles: { developer: 1, qa: 3 } }),
        scores: before,
      },
    });

    expect(text).toContain('## Compared with the earlier run');
    expect(text).toContain('- m: not_found (failed) → answered');
    expect(text).toContain('- commit: old → abc123def456');
    expect(text).toContain('- role developer version: 1 → 2');
  });

  it('marks a case that got worse as failed in the later run', () => {
    const after = scores.map((one) => (one.id === 'm' ? { ...one, passed: false } : one));

    expect(report({ scores: after, previous: { header: makeHeader(), scores } })).toContain(
      '- m: answered → answered (failed)',
    );
  });

  it('says when the earlier run was tied to the same things', () => {
    const text = report({ previous: { header: makeHeader(), scores } });

    expect(text).toContain('Same commit, model, role versions and base prompt.');
    expect(text).toContain('Changed outcome (status, or whether it passed): 0.');
  });

  it('has no comparison section when there is no earlier run', () => {
    expect(report()).not.toContain('Compared with the earlier run');
  });

  it('includes the feedback, or says there is none', () => {
    const { records } = parseFeedbackLines(
      JSON.stringify({
        timestamp: 't',
        question: 'q',
        role: 'qa',
        detailLevel: 'default',
        status: 'answered',
        confidence: null,
        citedKeys: [],
        rating: 'down',
        comment: 'bad',
        wrongSourceKey: 'C1',
        model: null,
      }),
    );

    expect(report({ feedback: { summary: summariseFeedback(records), skipped: 2 } })).toContain(
      '1 pieces of feedback: 0 up, 1 down (0% up). 1 have a comment. 2 lines could not be read and were skipped.',
    );
    expect(report({ feedback: { summary: summariseFeedback(records), skipped: 0 } })).toContain(
      'Sources named as wrong: C1 (1).',
    );
    expect(report({ feedback: { summary: summariseFeedback([]), skipped: 0 } })).toContain(
      'No feedback has been given yet.',
    );
    expect(report()).toContain('There is no feedback file.');
    expect(
      report({
        feedback: {
          summary: { ...summariseFeedback(records), wrongSources: {} },
          skipped: 0,
        },
      }),
    ).toContain('Sources named as wrong: none.');
  });

  it('is the same every time for the same input', () => {
    expect(report()).toBe(report());
  });

  it('ends with a line break', () => {
    expect(report().endsWith('\n')).toBe(true);
  });
});

describe('resolveRunFolder', () => {
  it('looks for a bare name under eval/results', () => {
    expect(resolveRunFolder('20261011-180000').replaceAll('\\', '/')).toBe(
      'eval/results/20261011-180000',
    );
  });

  it('takes a path from the working directory when it leads into eval/results', () => {
    expect(resolveRunFolder('eval/results/20261011-180000').replaceAll('\\', '/')).toBe(
      'eval/results/20261011-180000',
    );
    expect(resolveRunFolder(resolve('eval/results/one')).replaceAll('\\', '/')).toBe(
      'eval/results/one',
    );
  });

  it.each([
    '..',
    '../other',
    'eval/results/../../elsewhere',
    'somewhere/else',
    '.',
    'eval/results',
  ])('refuses %j, which is not a run folder under eval/results', (name) => {
    expect(() => resolveRunFolder(name)).toThrow(EvalError);
    expect(() => resolveRunFolder(name)).toThrow('is not a run folder under eval/results');
  });

  it('refuses an absolute path outside eval/results', () => {
    const absolute = process.platform === 'win32' ? 'C:\\runs\\one' : '/runs/one';

    expect(() => resolveRunFolder(absolute)).toThrow(EvalError);
  });
});
