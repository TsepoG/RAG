// @ts-check
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  feedbackToDraftCases,
  formatDraftCases,
  parseFeedbackLines,
} from '../../src/eval/feedback.js';
import { assertRunnable, loadCases } from '../../src/eval/load.js';
import { caseSchema } from '../../src/eval/schema.js';
import { EvalError } from '../../src/errors/index.js';

/**
 * Feedback records.
 * @param {Array<Record<string, unknown>>} changes - Fields to replace, one object per record.
 * @returns {import('../../src/eval/feedback.js').FeedbackRecord[]} The records.
 */
function records(changes) {
  const text = changes
    .map((change) =>
      JSON.stringify({
        timestamp: '2026-10-11T16:15:20.121Z',
        question: 'How long do customers have to ask for a refund?',
        role: 'product_owner',
        detailLevel: 'default',
        status: 'answered',
        confidence: 'medium',
        citedKeys: ['C1', 'G1'],
        rating: 'down',
        comment: null,
        wrongSourceKey: null,
        model: 'gpt-x',
        ...change,
      }),
    )
    .join('\n');
  return parseFeedbackLines(text).records;
}

describe('feedbackToDraftCases', () => {
  it('makes a draft case from a thumbs-down, marked as a draft', () => {
    const { cases } = feedbackToDraftCases(records([{}]));

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      role: 'product_owner',
      question: 'How long do customers have to ask for a refund?',
      draft: true,
      tags: [],
      expect: { status: 'answered' },
    });
  });

  it('makes no case from a thumbs-up', () => {
    expect(feedbackToDraftCases(records([{ rating: 'up' }])).cases).toEqual([]);
  });

  it('gives each case a readable id built from the role and the question', () => {
    const [one] = feedbackToDraftCases(records([{}])).cases;

    expect(one.id).toBe('fb-product-owner-how-long-do-customers-have-to-ask-for-a');
    expect(caseSchema.safeParse(one).success).toBe(true);
  });

  it('keeps ids to lower-case letters, digits and dashes whatever the question holds', () => {
    const [one] = feedbackToDraftCases(records([{ question: '  Où est l’API ?!  (v2) ' }])).cases;

    expect(one.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(caseSchema.safeParse(one).success).toBe(true);
  });

  it('falls back to a plain id when the question has no letters or digits', () => {
    const [one] = feedbackToDraftCases(records([{ question: '???' }])).cases;

    expect(one.id).toBe('fb-product-owner-question');
  });

  it('numbers an id that would otherwise repeat', () => {
    const { cases } = feedbackToDraftCases(
      records([
        { question: 'How long do customers have to ask for a refund on Monday?' },
        { question: 'How long do customers have to ask for a refund on Tuesday?' },
      ]),
    );

    expect(cases.map(({ id }) => id)).toEqual([
      'fb-product-owner-how-long-do-customers-have-to-ask-for-a',
      'fb-product-owner-how-long-do-customers-have-to-ask-for-a-2',
    ]);
  });

  it('writes a reference that says it still has to be written, and what the assistant did', () => {
    const [one] = feedbackToDraftCases(records([{}])).cases;

    const { reference } = /** @type {{ reference: string }} */ (one.expect);

    expect(reference).toContain('TO WRITE');
    expect(reference).toContain('answered, medium confidence');
    expect(reference).toContain('cited C1, G1');
  });

  it('adds what the person said, and the source they marked wrong', () => {
    const [one] = feedbackToDraftCases(
      records([{ comment: 'It is 14 days', wrongSourceKey: 'C1' }]),
    ).cases;

    const { reference } = /** @type {{ reference: string }} */ (one.expect);

    expect(reference).toContain('The person said: It is 14 days');
    expect(reference).toContain('They marked C1 as a wrong source');
  });

  it('says so when the answer cited nothing and claimed no confidence', () => {
    const [one] = feedbackToDraftCases(
      records([{ status: 'not_found', confidence: null, citedKeys: [] }]),
    ).cases;

    const { reference } = /** @type {{ reference: string }} */ (one.expect);

    expect(reference).toContain('The assistant gave: not_found; it cited nothing.');
  });

  it('makes one case for a question that got several thumbs-down, and counts the repeats', () => {
    const result = feedbackToDraftCases(
      records([{}, { question: '  how long do customers   have to ask for a REFUND?  ' }, {}]),
    );

    expect(result.cases).toHaveLength(1);
    expect(result.repeats).toBe(2);
  });

  it('treats the same question for another role as a different case', () => {
    const { cases } = feedbackToDraftCases(records([{}, { role: 'developer' }]));

    expect(cases.map(({ role }) => role)).toEqual(['product_owner', 'developer']);
  });

  it('skips a question that is already in the eval set, and keeps ids unique against it', () => {
    const existing = [
      {
        id: 'fb-product-owner-how-long-do-customers-have-to-ask-for-a',
        role: 'qa',
        question: 'Other?',
      },
      {
        id: 'old-one',
        role: 'product_owner',
        question: 'How long do customers have to ask for a refund?',
      },
    ];

    const result = feedbackToDraftCases(
      records([{}, { question: 'A new question about shipping' }]),
      existing,
    );

    expect(result.repeats).toBe(1);
    expect(result.cases.map(({ question }) => question)).toEqual(['A new question about shipping']);
  });

  it('makes no cases from no feedback', () => {
    expect(feedbackToDraftCases([])).toEqual({ cases: [], repeats: 0 });
  });
});

describe('formatDraftCases', () => {
  it('writes a file that starts with what to do, and loads as draft cases', async () => {
    const { cases } = feedbackToDraftCases(
      records([
        { comment: 'Wrong, "really": see\nthe second line' },
        { question: 'What about gift cards?', role: 'developer' },
      ]),
    );
    const text = formatDraftCases(cases);

    const loaded = await loadCases({
      file: 'drafts.yaml',
      readFile: async () => text,
      roles: new Set(['product_owner', 'developer']),
    });

    expect(text.startsWith('# Drafts made from thumbs-down feedback.')).toBe(true);
    expect(loaded).toHaveLength(2);
    expect(loaded.every(({ draft }) => draft)).toBe(true);
    expect(parse(text).cases[0].expect.reference).toContain(
      'Wrong, "really": see\nthe second line',
    );
  });

  it('cannot be run until each case has been checked', async () => {
    const { cases } = feedbackToDraftCases(records([{}]));
    const loaded = await loadCases({
      file: 'drafts.yaml',
      readFile: async () => formatDraftCases(cases),
      roles: new Set(['product_owner']),
    });

    expect(() => assertRunnable(loaded)).toThrow(EvalError);
  });
});
