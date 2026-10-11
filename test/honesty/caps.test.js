// @ts-check
import { describe, expect, it } from 'vitest';
import { applyConfidenceCaps, NO_META_REASON } from '../../src/honesty/index.js';

const RANK = { high: 3, medium: 2, low: 1 };
const MODEL_REASON = 'Every statement is in the page.';

/**
 * Builds what the caps look at: a clean, confident answer unless a test says otherwise.
 * @param {Record<string, any>} [changes] - Fields to change. `meta` is merged; `meta: null` means no report.
 * @returns {Parameters<typeof applyConfidenceCaps>[0]} The input.
 */
function input({ meta, ...rest } = {}) {
  return {
    meta:
      meta === null
        ? undefined
        : {
            status: /** @type {const} */ ('answered'),
            confidence: /** @type {const} */ ('high'),
            confidenceReason: MODEL_REASON,
            gaps: [],
            conflicts: [],
            ...meta,
          },
    validation: { citedKeys: ['C1'], invalidKeys: [], inferredKeys: [] },
    sources: [{ type: 'confluence', stale: false }],
    folderOnlySentences: [],
    uncitedSentences: [],
    ...rest,
  };
}

const CONFLICT = {
  topic: 'Refund window',
  docSays: '30 days',
  docKeys: ['C1'],
  codeSays: '14 days',
  codeKeys: ['G1'],
};

describe('applyConfidenceCaps a clean answer', () => {
  it.each(['high', 'medium', 'low'])('keeps the model level %s and its reason', (confidence) => {
    expect(applyConfidenceCaps(input({ meta: { confidence } }))).toEqual({
      status: 'answered',
      confidence,
      confidenceReason: MODEL_REASON,
      capsApplied: [],
    });
  });

  it('adds a full stop to a reason that has none', () => {
    const result = applyConfidenceCaps(input({ meta: { confidenceReason: 'Stated in the page' } }));

    expect(result.confidenceReason).toBe('Stated in the page.');
  });
});

describe('applyConfidenceCaps one rule at a time', () => {
  it.each([
    [
      'invalid-keys',
      'an invented key was removed',
      { validation: { citedKeys: ['C1'], invalidKeys: ['C9'], inferredKeys: [] } },
      'medium',
    ],
    [
      'uncited-sentences',
      'a sentence has no citation',
      { uncitedSentences: ['A claim with no source at all.'] },
      'medium',
    ],
    [
      'stale-page',
      'a cited page is stale',
      { sources: [{ type: 'confluence', stale: true }] },
      'medium',
    ],
    [
      'inferred',
      'a citation carries an asterisk',
      { validation: { citedKeys: ['G1'], invalidKeys: [], inferredKeys: ['G1'] } },
      'medium',
    ],
    [
      'folder-only',
      'a sentence rests on a folder listing',
      { folderOnlySentences: ['The code is in src.'] },
      'medium',
    ],
    [
      'gaps',
      'the model listed gaps',
      { meta: { gaps: ['No page covers partial refunds'] } },
      'medium',
    ],
    ['conflicts', 'the model reported a conflict', { meta: { conflicts: [CONFLICT] } }, 'low'],
  ])('%s caps a confident answer when %s', (code, _when, changes, level) => {
    const result = applyConfidenceCaps(input(changes));

    expect(result.status).toBe('answered');
    expect(result.confidence).toBe(level);
    expect(result.capsApplied.map((cap) => cap.code)).toEqual([code]);
  });

  it('puts the reason of the rule after the model reason', () => {
    const result = applyConfidenceCaps(input({ uncitedSentences: ['A claim with no source.'] }));

    expect(result.confidenceReason).toBe(`${MODEL_REASON} Some statements have no citation.`);
    expect(result.capsApplied[0].reason).toBe('Some statements have no citation.');
  });

  it('does not count a stale file, or a page that is not stale', () => {
    const result = applyConfidenceCaps(
      input({
        sources: [
          { type: 'github', stale: true },
          { type: 'confluence', stale: false },
          { type: 'confluence' },
        ],
      }),
    );

    expect(result.capsApplied).toEqual([]);
  });

  it('keeps low when a rule only asks for medium', () => {
    const result = applyConfidenceCaps(
      input({ meta: { confidence: 'low' }, uncitedSentences: ['A claim.'] }),
    );

    expect(result.confidence).toBe('low');
    expect(result.capsApplied).toHaveLength(1);
  });

  it('lowers medium to low for a conflict', () => {
    expect(
      applyConfidenceCaps(input({ meta: { confidence: 'medium', conflicts: [CONFLICT] } }))
        .confidence,
    ).toBe('low');
  });
});

describe('applyConfidenceCaps rules together', () => {
  it('limits stale and conflicts to low, with both reasons in the order the rules are checked', () => {
    const result = applyConfidenceCaps(
      input({
        sources: [{ type: 'confluence', stale: true }],
        meta: { conflicts: [CONFLICT] },
      }),
    );

    expect(result.confidence).toBe('low');
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['stale-page', 'conflicts']);
    expect(result.confidenceReason).toBe(
      `${MODEL_REASON} A cited page was last updated more than a year ago. The documentation and the code disagree.`,
    );
  });

  it('lists every rule that holds, medium or not', () => {
    const result = applyConfidenceCaps(
      input({
        validation: { citedKeys: ['G1'], invalidKeys: ['C9'], inferredKeys: ['G1'] },
        uncitedSentences: ['A claim.'],
        folderOnlySentences: ['A folder.'],
        meta: { gaps: ['A gap'] },
      }),
    );

    expect(result.confidence).toBe('medium');
    expect(result.capsApplied.map(({ code }) => code)).toEqual([
      'invalid-keys',
      'uncited-sentences',
      'inferred',
      'folder-only',
      'gaps',
    ]);
  });

  const everyRule = {
    validation: { citedKeys: ['C1'], invalidKeys: ['C9'], inferredKeys: ['C1'] },
    sources: [{ type: 'confluence', stale: true }],
    folderOnlySentences: ['A folder.'],
    uncitedSentences: ['A claim.'],
  };

  it.each(['high', 'medium', 'low'])('never raises a model level of %s', (confidence) => {
    const cases = [
      input({ meta: { confidence } }),
      input({ meta: { confidence, gaps: ['x'] }, ...everyRule }),
      input({ meta: { confidence, conflicts: [CONFLICT] }, ...everyRule }),
      input({ meta: { confidence }, uncitedSentences: ['A claim.'] }),
    ];

    cases.forEach((one) => {
      const result = applyConfidenceCaps(one);
      expect(RANK[/** @type {'high'} */ (result.confidence)]).toBeLessThanOrEqual(
        RANK[/** @type {'high'} */ (confidence)],
      );
    });
  });
});

describe('applyConfidenceCaps no valid citations', () => {
  it('turns an answer into not found, whatever else is true', () => {
    const result = applyConfidenceCaps(
      input({
        validation: { citedKeys: [], invalidKeys: ['C9'], inferredKeys: [] },
        meta: { gaps: ['x'], conflicts: [CONFLICT] },
        uncitedSentences: ['A claim.'],
      }),
    );

    expect(result).toEqual({
      status: 'not_found',
      confidence: null,
      confidenceReason: 'None of the answer could be tied to a source that was fetched.',
      capsApplied: [
        {
          code: 'no-citations',
          reason: 'None of the answer could be tied to a source that was fetched.',
        },
      ],
    });
  });
});

describe('applyConfidenceCaps statuses the model reports', () => {
  it.each(['not_found', 'out_of_scope', 'clarify'])(
    'accepts %s and gives it no confidence',
    (status) => {
      const meta = {
        status,
        confidence: undefined,
        confidenceReason: 'Nothing relevant',
        clarifyingQuestion: 'Which one?',
      };

      const result = applyConfidenceCaps(
        input({ meta, validation: { citedKeys: [], invalidKeys: ['C9'], inferredKeys: [] } }),
      );

      expect(result).toEqual({
        status,
        confidence: null,
        confidenceReason: 'Nothing relevant.',
        capsApplied: [],
      });
    },
  );

  it('ignores a confidence the model gave with a status that has none', () => {
    const result = applyConfidenceCaps(
      input({ meta: { status: 'out_of_scope', confidence: 'high' } }),
    );

    expect(result.confidence).toBeNull();
  });
});

describe('applyConfidenceCaps a missing report', () => {
  it('counts as low with the reason that the model did not report', () => {
    expect(applyConfidenceCaps(input({ meta: null }))).toEqual({
      status: 'answered',
      confidence: 'low',
      confidenceReason: NO_META_REASON,
      capsApplied: [{ code: 'no-meta', reason: NO_META_REASON }],
    });
  });

  it('says so in plain words', () => {
    expect(NO_META_REASON).toBe('The assistant did not report its confidence.');
  });

  it('still runs the other rules and lists them after the missing report', () => {
    const result = applyConfidenceCaps(input({ meta: null, uncitedSentences: ['A claim.'] }));

    expect(result.confidence).toBe('low');
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['no-meta', 'uncited-sentences']);
    expect(result.confidenceReason).toBe(`${NO_META_REASON} Some statements have no citation.`);
  });

  it('becomes not found when nothing is cited, and says why it had no report', () => {
    const result = applyConfidenceCaps(
      input({ meta: null, validation: { citedKeys: [], invalidKeys: [], inferredKeys: [] } }),
    );

    expect(result.status).toBe('not_found');
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['no-meta', 'no-citations']);
  });
});
