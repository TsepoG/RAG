// @ts-check
import { describe, expect, it } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { parseEvalArguments } from '../../src/eval/args.js';
import { formatResults, parseResults } from '../../src/eval/results.js';
import {
  formatConfusion,
  formatFailures,
  formatRunInfo,
  formatSummary,
} from '../../src/eval/summary.js';
import { percent, ratioText, seconds, table } from '../../src/eval/format.js';
import { summarise } from '../../src/eval/summarise.js';
import { makeScore } from '../helpers/eval.js';

const HEADER = {
  startedAt: '2026-10-11T18:00:00.000Z',
  commit: 'abc123def456',
  dirty: false,
  model: 'gpt-x',
  roles: { qa: 3, developer: 2 },
  basePromptHash: '0123456789ab',
  requests: { used: 14, casesRun: 8, stoppedEarly: false },
  interrupted: false,
};

/**
 * A case as it ran.
 * @param {string} id - The case id.
 * @param {string} [answer] - The answer text.
 * @returns {import('../../src/eval/run.js').RunEntry} The entry.
 */
function entry(id, answer = 'Thirty days.') {
  return {
    id,
    role: 'developer',
    question: 'How long?',
    tags: ['smoke'],
    reference: 'Thirty days.',
    score: makeScore({ id }),
    result: { answer, status: 'answered' },
    error: undefined,
  };
}

describe('formatResults and parseResults', () => {
  it('write the run on the first line and one line for each case, and read them back', () => {
    const text = formatResults(HEADER, [entry('a'), entry('b')]);

    expect(text.trim().split('\n')).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(true);
    const { header, entries } = parseResults(text);
    expect(header).toEqual(HEADER);
    expect(entries.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(entries[0].result).toEqual({ answer: 'Thirty days.', status: 'answered' });
  });

  it('keep an answer with line breaks, quotes and commas on one line', () => {
    const answer = 'Line one,\n"quoted"\r\nline three';

    const text = formatResults(HEADER, [entry('a', answer)]);

    expect(text.trim().split('\n')).toHaveLength(2);
    expect(parseResults(text).entries[0].result?.answer).toBe(answer);
  });

  it('read a run with no cases', () => {
    expect(parseResults(formatResults(HEADER, [])).entries).toEqual([]);
  });

  it('ignore blank lines', () => {
    const text = `\n${formatResults(HEADER, [entry('a')])}\n\n`;

    expect(parseResults(text).entries).toHaveLength(1);
  });

  it('refuse a line that is not JSON, naming the line', () => {
    const text = `${formatResults(HEADER, [entry('a')])}{broken`;

    expect(() => parseResults(text)).toThrow('Line 3 of the results is not JSON.');
  });

  it.each([
    ['an empty file', ''],
    [
      'a file that starts with a case',
      formatResults(HEADER, [entry('a')])
        .split('\n')
        .slice(1)
        .join('\n'),
    ],
    ['a first line that is not a run', '{"type":"case"}'],
  ])('refuse %s', (_name, text) => {
    expect(() => parseResults(text)).toThrow('must start with a line that describes the run');
  });

  it('refuse a case line that is incomplete, naming the line', () => {
    const text = `${formatResults(HEADER, [])}{"type":"case","id":"a"}\n`;

    expect(() => parseResults(text)).toThrow('Line 2 of the results is not a case.');
    expect(() => parseResults(text)).toThrow(EvalError);
  });
});

describe('format helpers', () => {
  it('write shares as whole percentages, and "n/a" when there is none', () => {
    expect(percent(0.756)).toBe('76%');
    expect(percent(0)).toBe('0%');
    expect(percent(undefined)).toBe('n/a');
  });

  it('write a count out of a total with its share, or "n/a" for a total of zero', () => {
    expect(ratioText({ count: 3, of: 4, rate: 0.75 })).toBe('3/4 (75%)');
    expect(ratioText({ count: 0, of: 0, rate: undefined })).toBe('n/a');
  });

  it('write milliseconds as seconds', () => {
    expect(seconds(4250)).toBe('4.3 s');
    expect(seconds(undefined)).toBe('n/a');
  });

  it('build a markdown table', () => {
    expect(table(['A', 'B'], [['1', '2']])).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
});

describe('formatSummary', () => {
  const scores = [
    makeScore({ id: 'a', expectedStatus: 'answered', status: 'answered', confidence: 'high' }),
    makeScore({
      id: 'b',
      expectedStatus: 'out_of_scope',
      status: 'answered',
      statusMatch: false,
      passed: false,
      declinedAppropriately: false,
      honest: false,
    }),
  ];
  const summary = summarise(scores);

  it('shows what the run was tied to', () => {
    const text = formatSummary({ run: HEADER, summary });

    expect(text).toContain('abc123def456');
    expect(text).toContain('gpt-x');
    expect(text).toContain('developer v2, qa v3');
    expect(text).toContain('0123456789ab');
    expect(text).toContain('14 for 8 cases');
  });

  it('says when the working tree had uncommitted changes, and the request limit', () => {
    const run = { ...HEADER, dirty: true, requests: { ...HEADER.requests, limit: 20 } };

    expect(formatRunInfo(run)).toContain('abc123def456 (uncommitted changes)');
    expect(formatRunInfo(run)).toContain('(limit 20)');
  });

  it('shows the results, and explains why two of them differ', () => {
    const text = formatSummary({ run: HEADER, summary });

    expect(text).toContain('## Results (2 cases)');
    expect(text).toContain('Status exactly as expected | 1/2 (50%)');
    expect(text).toContain(
      'Declined when it should (not_found or out_of_scope, either) | 0/1 (0%)',
    );
    expect(text).toContain('a not_found answer to an out_of_scope question is a miss');
  });

  it('shows the confidence claimed, the matrix and the failed checks', () => {
    const text = formatSummary({ run: HEADER, summary });

    expect(text).toContain('high 1, medium 1, low 0, none 0');
    expect(text).toContain('| Expected / got | answered |');
    expect(text).toContain('**wrongStatus** (1): b');
  });

  it('says so when the run was interrupted', () => {
    const text = formatSummary({ run: { ...HEADER, interrupted: true }, summary });

    expect(text).toContain('The run was interrupted');
  });

  it('is the same every time for the same input', () => {
    expect(formatSummary({ run: HEADER, summary })).toBe(formatSummary({ run: HEADER, summary }));
  });

  it('copes with an empty run', () => {
    const text = formatSummary({ run: HEADER, summary: summarise([]) });

    expect(text).toContain('## Results (0 cases)');
    expect(text).toContain('No check failed.');
  });

  it('writes the matrix with only the statuses that occur', () => {
    const text = formatConfusion({
      answered: { answered: 2 },
      out_of_scope: { answered: 1, error: 1 },
    });

    expect(text).toBe(
      [
        '| Expected / got | answered | error |',
        '| --- | --- | --- |',
        '| answered | 2 | 0 |',
        '| out_of_scope | 1 | 1 |',
      ].join('\n'),
    );
  });

  it('lists the failed checks with their case ids', () => {
    expect(formatFailures({ dishonest: ['x', 'y'] })).toBe('- **dishonest** (2): x, y');
    expect(formatFailures({})).toBe('No check failed.');
  });
});

describe('parseEvalArguments', () => {
  it('runs the full set, with no filter, no limit and a question first, by default', () => {
    expect(parseEvalArguments([])).toEqual({
      subset: 'full',
      caseId: undefined,
      role: undefined,
      maxRequests: undefined,
      yes: false,
    });
  });

  it('reads every option', () => {
    expect(
      parseEvalArguments([
        '--subset',
        'smoke',
        '--case',
        'dev-one',
        '--role',
        'qa',
        '--max-requests',
        '12',
        '--yes',
      ]),
    ).toEqual({ subset: 'smoke', caseId: 'dev-one', role: 'qa', maxRequests: 12, yes: true });
  });

  it.each([
    ['an unknown option', ['--fast']],
    ['a word that is not an option', ['everything']],
    ['an option with no value', ['--role']],
    ['a subset that does not exist', ['--subset', 'half']],
    ['a limit that is not a number', ['--max-requests', 'many']],
    ['a limit of zero', ['--max-requests', '0']],
    ['a limit that is not whole', ['--max-requests', '2.5']],
  ])('refuses %s, with the usage', (_name, argv) => {
    expect(() => parseEvalArguments(argv)).toThrow(EvalError);
    expect(() => parseEvalArguments(argv)).toThrow('Usage: npm run eval');
  });
});
