// @ts-check
import { describe, expect, it } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { parseCsv, toCsv } from '../../src/eval/csv.js';
import {
  buildReviewRows,
  parseReviewCsv,
  REVIEW_COLUMNS,
  toReviewCsv,
} from '../../src/eval/review.js';
import { makeScore } from '../helpers/eval.js';

/**
 * A case as it ran.
 * @param {string} id - The case id.
 * @param {Partial<import('../../src/eval/run.js').RunEntry>} [changes] - Fields to replace.
 * @returns {import('../../src/eval/run.js').RunEntry} The entry.
 */
function entry(id, changes = {}) {
  return {
    id,
    role: 'developer',
    question: 'How long?',
    tags: [],
    reference: 'Thirty days.',
    score: makeScore({ id, status: 'answered', confidence: 'medium' }),
    result: {
      answer: 'Thirty days [C1].',
      sources: [
        { key: 'C1', title: 'Refund Policy' },
        { key: 'G1', title: 'src/refunds/window.js' },
      ],
    },
    error: undefined,
    ...changes,
  };
}

const AWKWARD = 'Line one, with a comma\n"quoted" and\r\nanother line, é “curly” ’';

describe('toCsv and parseCsv', () => {
  it('round trip text with commas, quotes, line breaks and accents', () => {
    const rows = [
      ['id', 'text'],
      ['a', AWKWARD],
      ['b', ''],
      ['c', '"'],
    ];

    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('starts with a byte-order mark, so Excel reads it as UTF-8, and parsing ignores it', () => {
    const text = toCsv([['a']]);

    expect(text.codePointAt(0)).toBe(0xfeff);
    expect(parseCsv(text)).toEqual([['a']]);
  });

  it('quotes only the fields that need it', () => {
    expect(toCsv([['plain', 'a,b', 'say "hi"']]).slice(1)).toBe('plain,"a,b","say ""hi"""\n');
  });

  it('reads rows that end in a line feed, a carriage return and line feed, or nothing', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d\r')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a\n\n\nb\n')).toEqual([['a'], ['b']]);
  });

  it('keeps empty fields, including a last one', () => {
    expect(parseCsv('a,,c,\n,,\n')).toEqual([
      ['a', '', 'c', ''],
      ['', '', ''],
    ]);
  });

  it('reads a quoted empty field as a row', () => {
    expect(parseCsv('""\n')).toEqual([['']]);
  });

  it('reads no rows from empty text', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('refuses a quoted field that is never closed', () => {
    expect(() => parseCsv('a,"oops\nb')).toThrow(EvalError);
    expect(() => parseCsv('a,"oops')).toThrow('never closed');
  });
});

describe('buildReviewRows', () => {
  it('has a row per case, with the answer, its sources and how sure it was', () => {
    const [row] = buildReviewRows([entry('a')]);

    expect(row).toEqual({
      id: 'a',
      role: 'developer',
      question: 'How long?',
      reference: 'Thirty days.',
      answer: 'Thirty days [C1].',
      sources: '[C1] Refund Policy; [G1] src/refunds/window.js',
      status: 'answered',
      confidence: 'medium',
    });
  });

  it('leaves the confidence empty when none was claimed, and the sources when there are none', () => {
    const [row] = buildReviewRows([
      entry('a', {
        score: makeScore({ id: 'a', status: 'not_found', confidence: null }),
        result: { answer: 'I could not find this.', status: 'not_found' },
      }),
    ]);

    expect(row).toMatchObject({ confidence: '', sources: '', status: 'not_found' });
  });

  it('writes a case that failed as an error line, so the reviewer sees why there is no answer', () => {
    const [row] = buildReviewRows([
      entry('a', {
        result: undefined,
        error: { kind: 'AskTimeoutError', message: 'took too long' },
        score: makeScore({ id: 'a', status: 'error' }),
      }),
    ]);

    expect(row.answer).toBe('ERROR (AskTimeoutError): took too long');
    expect(row.status).toBe('error');
  });

  it('keeps the order the cases ran in', () => {
    expect(buildReviewRows([entry('b'), entry('a')]).map(({ id }) => id)).toEqual(['b', 'a']);
  });
});

describe('toReviewCsv', () => {
  it('writes the header, then a row per case with empty verdict and note columns', () => {
    const rows = parseCsv(toReviewCsv(buildReviewRows([entry('a'), entry('b')])));

    expect(rows[0]).toEqual([...REVIEW_COLUMNS]);
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(-2)).toEqual(['', '']);
    expect(rows[1].slice(0, 3)).toEqual(['a', 'developer', 'How long?']);
  });

  it('keeps an answer with commas, quotes and line breaks in one cell', () => {
    const rows = parseCsv(
      toReviewCsv(buildReviewRows([entry('a', { result: { answer: AWKWARD, sources: [] } })])),
    );

    expect(rows[1][4]).toBe(AWKWARD);
  });
});

/**
 * A sheet, as the owner might leave it.
 * @param {Array<[string, string, string?]>} lines - Id, verdict and an optional note per row.
 * @returns {string} The CSV text.
 */
function sheet(lines) {
  return toCsv([
    ['id', 'role', 'verdict', 'note'],
    ...lines.map(([id, verdict, note = '']) => [id, 'developer', verdict, note]),
  ]);
}

describe('parseReviewCsv', () => {
  const ids = ['a', 'b', 'c'];

  it('reads each verdict and note', () => {
    const { judgements } = parseReviewCsv(
      sheet([
        ['a', 'correct', 'spot on'],
        ['b', 'partial'],
        ['c', 'wrong', 'cited the wrong page'],
      ]),
      ids,
    );

    expect([...judgements]).toEqual([
      ['a', { verdict: 'correct', note: 'spot on' }],
      ['b', { verdict: 'partial', note: '' }],
      ['c', { verdict: 'wrong', note: 'cited the wrong page' }],
    ]);
  });

  it('accepts a verdict in any case, with spaces around it', () => {
    const { judgements } = parseReviewCsv(
      sheet([
        ['a', '  Correct '],
        ['b', 'WRONG'],
        ['c', 'Partial'],
      ]),
      ids,
    );

    expect([...judgements.values()].map(({ verdict }) => verdict)).toEqual([
      'correct',
      'wrong',
      'partial',
    ]);
  });

  it('lists the rows that have no verdict yet, without treating them as a problem', () => {
    const result = parseReviewCsv(
      sheet([
        ['a', 'correct'],
        ['b', ''],
        ['c', '  '],
      ]),
      ids,
    );

    expect(result.blank).toEqual(['b', 'c']);
    expect(result.judgements.size).toBe(1);
  });

  it('reports the cases that have no row at all', () => {
    const result = parseReviewCsv(sheet([['a', 'correct']]), ids);

    expect(result.missing).toEqual(['b', 'c']);
  });

  it('reports no missing case when every row is there, even with a blank verdict', () => {
    const text = sheet([
      ['a', ''],
      ['b', ''],
      ['c', ''],
    ]);

    expect(parseReviewCsv(text, ids).missing).toEqual([]);
  });

  it('refuses a verdict that is not correct, partial or wrong, naming the row', () => {
    const failure = () =>
      parseReviewCsv(
        sheet([
          ['a', 'correct'],
          ['b', 'mostly'],
        ]),
        ids,
      );

    expect(failure).toThrow(EvalError);
    expect(failure).toThrow('Row 3 ("b"): "mostly" is not one of correct, partial, wrong');
  });

  it('refuses an id that is not in the run', () => {
    expect(() => parseReviewCsv(sheet([['zzz', 'correct']]), ids)).toThrow(
      'this case is not in the run',
    );
  });

  it('refuses an id that appears twice', () => {
    const text = sheet([
      ['a', 'correct'],
      ['a', 'wrong'],
    ]);

    expect(() => parseReviewCsv(text, ids)).toThrow('the id appears more than once');
  });

  it('reports every problem at once', () => {
    const failure = () =>
      parseReviewCsv(
        sheet([
          ['a', 'meh'],
          ['zzz', 'correct'],
        ]),
        ids,
      );

    expect(failure).toThrow('- Row 2 ("a")');
    expect(failure).toThrow('- Row 3 ("zzz")');
  });

  it.each(['id', 'verdict'])('refuses a sheet with no %s column', (column) => {
    const header = ['id', 'verdict'].map((name) => (name === column ? 'other' : name));

    expect(() => parseReviewCsv(toCsv([header, ['a', 'correct']]), ids)).toThrow(
      `no "${column}" column`,
    );
  });

  it('finds the columns by name, wherever they are, whatever their case', () => {
    const text = toCsv([
      ['Note', 'VERDICT', 'Id'],
      ['fine', 'correct', 'a'],
    ]);

    expect(parseReviewCsv(text, ids).judgements.get('a')).toEqual({
      verdict: 'correct',
      note: 'fine',
    });
  });

  it('works without a note column', () => {
    const text = toCsv([
      ['id', 'verdict'],
      ['a', 'wrong'],
    ]);

    expect(parseReviewCsv(text, ids).judgements.get('a')).toEqual({ verdict: 'wrong', note: '' });
  });

  it('refuses an empty sheet', () => {
    expect(() => parseReviewCsv('', ids)).toThrow('The review sheet is empty.');
  });

  it('reads back the sheet it wrote, once the owner fills in a verdict', () => {
    const written = toReviewCsv(buildReviewRows([entry('a'), entry('b')]));
    const rows = parseCsv(written);
    rows[1][8] = 'correct';
    rows[2][8] = 'wrong';
    rows[2][9] = 'wrong window';

    const { judgements, blank } = parseReviewCsv(toCsv(rows), ['a', 'b']);

    expect(blank).toEqual([]);
    expect(judgements.get('b')).toEqual({ verdict: 'wrong', note: 'wrong window' });
  });
});

describe('review sheets with missing cells', () => {
  it('writes an empty answer for a stored result that has none', () => {
    const [row] = buildReviewRows([entry('a', { result: {} })]);

    expect(row.answer).toBe('');
    expect(row.sources).toBe('');
  });

  it('treats a row that stops early as having no verdict, and no note', () => {
    const text = toCsv([['id', 'role', 'verdict', 'note'], ['a'], ['b', 'developer', 'wrong']]);

    const result = parseReviewCsv(text, ['a', 'b']);

    expect(result.blank).toEqual(['a']);
    expect(result.judgements.get('b')).toEqual({ verdict: 'wrong', note: '' });
  });

  it('refuses a row that has no id at all', () => {
    const text = toCsv([
      ['id', 'verdict'],
      ['', 'wrong'],
    ]);

    expect(() => parseReviewCsv(text, ['a'])).toThrow('this case is not in the run');
  });
});

describe('review sheets where the id column is not first', () => {
  it('refuses a row that stops before the id', () => {
    const text = toCsv([['verdict', 'id'], ['wrong']]);

    expect(() => parseReviewCsv(text, ['a'])).toThrow('this case is not in the run');
  });
});
