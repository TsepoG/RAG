// @ts-check
import { describe, expect, it } from 'vitest';
import { partitionExpected, sourceMatches } from '../../src/eval/match.js';
import { ERROR_STATUS, scoreCase, scoreFailure } from '../../src/eval/score.js';
import { makeCase, makeResult } from '../helpers/eval.js';

const CONTEXT = { depth: 3, maxToolCalls: 12 };

const PAGE = { type: /** @type {const} */ ('confluence'), id: '12345', title: 'Refund Policy v3' };
const FILE = {
  type: /** @type {const} */ ('github'),
  repo: 'acme/app',
  path: 'src/refunds/window.js',
  title: 'src/refunds/window.js',
};

/**
 * Builds a case that expects given sources.
 * @param {Record<string, unknown>} expectChanges - Fields of `expect` to set.
 * @returns {import('../../src/eval/schema.js').EvalCase} The case.
 */
function expecting(expectChanges) {
  return makeCase({ expect: { status: 'answered', reference: 'r', ...expectChanges } });
}

describe('sourceMatches', () => {
  it('matches a Confluence page by its id, exactly', () => {
    expect(sourceMatches(PAGE, { type: 'confluence', match: '12345' })).toBe(true);
    expect(sourceMatches(PAGE, { type: 'confluence', match: '1234' })).toBe(false);
  });

  it('matches a Confluence page by a fragment of its title, ignoring case', () => {
    expect(sourceMatches(PAGE, { type: 'confluence', match: 'refund policy' })).toBe(true);
    expect(sourceMatches(PAGE, { type: 'confluence', match: 'Shipping' })).toBe(false);
  });

  it('matches a GitHub source by a fragment of its repository and path, or its title', () => {
    expect(sourceMatches(FILE, { type: 'github', match: 'refunds/window' })).toBe(true);
    expect(sourceMatches(FILE, { type: 'github', match: 'ACME/APP' })).toBe(true);
    expect(sourceMatches(FILE, { type: 'github', match: 'delivery' })).toBe(false);
  });

  it('never matches a source of the other type', () => {
    expect(sourceMatches(PAGE, { type: 'github', match: 'Refund' })).toBe(false);
    expect(sourceMatches(FILE, { type: 'confluence', match: 'window' })).toBe(false);
  });

  it('copes with a source that has no repository or path', () => {
    const bare = { type: /** @type {const} */ ('github'), title: 'Release v1' };

    expect(sourceMatches(bare, { type: 'github', match: 'release' })).toBe(true);
    expect(sourceMatches(bare, { type: 'github', match: 'src' })).toBe(false);
  });
});

describe('partitionExpected', () => {
  it('splits what was cited from what was not', () => {
    const wanted = [
      { type: /** @type {const} */ ('confluence'), match: 'Refund' },
      { type: /** @type {const} */ ('github'), match: 'delivery' },
    ];

    const { found, missed } = partitionExpected(wanted, [PAGE, FILE]);

    expect(found).toEqual([wanted[0]]);
    expect(missed).toEqual([wanted[1]]);
  });
});

describe('scoreCase: status', () => {
  it('matches when the status is exactly the expected one', () => {
    const score = scoreCase(makeCase(), makeResult(), CONTEXT);

    expect(score).toMatchObject({
      statusMatch: true,
      status: 'answered',
      expectedStatus: 'answered',
    });
  });

  it('does not match when it differs, even for another way of declining', () => {
    const score = scoreCase(
      makeCase({ expect: { status: 'not_found', reference: 'r' } }),
      makeResult({ status: 'out_of_scope', confidence: null }),
      CONTEXT,
    );

    expect(score.statusMatch).toBe(false);
  });

  it('carries the case id, role, tags and the confidence claimed', () => {
    const score = scoreCase(
      makeCase({ tags: ['smoke'] }),
      makeResult({ confidence: 'high' }),
      CONTEXT,
    );

    expect(score).toMatchObject({
      id: 'dev-refund',
      role: 'developer',
      tags: ['smoke'],
      confidence: 'high',
    });
  });
});

describe('scoreCase: declining and honesty', () => {
  const declines = makeCase({ expect: { status: 'out_of_scope', reference: 'r' } });

  it.each(['not_found', 'out_of_scope'])(
    'counts %s as declining when a decline is expected',
    (status) => {
      const score = scoreCase(
        declines,
        makeResult({ status: /** @type {any} */ (status), confidence: null }),
        CONTEXT,
      );

      expect(score.declinedAppropriately).toBe(true);
      expect(score.honest).toBe(true);
    },
  );

  it('counts not_found as declining appropriately for an out_of_scope case, though the status differs', () => {
    const score = scoreCase(
      declines,
      makeResult({ status: 'not_found', confidence: null }),
      CONTEXT,
    );

    expect(score.statusMatch).toBe(false);
    expect(score.declinedAppropriately).toBe(true);
  });

  it.each(['high', 'medium'])('is dishonest when it answers with %s confidence', (confidence) => {
    const score = scoreCase(
      declines,
      makeResult({ confidence: /** @type {any} */ (confidence) }),
      CONTEXT,
    );

    expect(score).toMatchObject({ declinedAppropriately: false, honest: false, passed: false });
  });

  it('is honest, though it did not decline, when it answers with low confidence', () => {
    const score = scoreCase(declines, makeResult({ confidence: 'low' }), CONTEXT);

    expect(score).toMatchObject({ declinedAppropriately: false, honest: true });
  });

  it('is honest when it asks a question instead', () => {
    const score = scoreCase(declines, makeResult({ status: 'clarify', confidence: null }), CONTEXT);

    expect(score.honest).toBe(true);
  });

  it('does not apply to a case that expects an answer', () => {
    const score = scoreCase(makeCase(), makeResult(), CONTEXT);

    expect(score.declinedAppropriately).toBeUndefined();
    expect(score.honest).toBeUndefined();
  });
});

describe('scoreCase: citations', () => {
  const both = expecting({
    sources: [
      { type: 'confluence', match: 'Refund' },
      { type: 'github', match: 'window.js' },
    ],
  });

  it('has full recall when every expected source was cited', () => {
    const score = scoreCase(both, makeResult({ sources: [PAGE, FILE] }), CONTEXT);

    expect(score).toMatchObject({ citationRecall: 1, missedSources: 0 });
  });

  it('has partial recall when only some were', () => {
    const score = scoreCase(both, makeResult({ sources: [PAGE] }), CONTEXT);

    expect(score).toMatchObject({ citationRecall: 0.5, missedSources: 1 });
  });

  it('has no recall when none were', () => {
    const score = scoreCase(both, makeResult({ sources: [] }), CONTEXT);

    expect(score.citationRecall).toBe(0);
  });

  it('has no recall to report when the case expects no sources', () => {
    expect(
      scoreCase(makeCase(), makeResult({ sources: [PAGE] }), CONTEXT).citationRecall,
    ).toBeUndefined();
  });

  it('counts each forbidden source that was cited, and fails the case', () => {
    const entry = expecting({
      mustNotCite: [
        { type: 'confluence', match: 'Refund' },
        { type: 'github', match: 'legacy' },
      ],
    });

    const score = scoreCase(entry, makeResult({ sources: [PAGE, FILE] }), CONTEXT);

    expect(score.mustNotCiteHits).toBe(1);
    expect(score.passed).toBe(false);
  });

  it('counts no forbidden source when none was cited', () => {
    const entry = expecting({ mustNotCite: [{ type: 'github', match: 'legacy' }] });

    expect(scoreCase(entry, makeResult({ sources: [PAGE] }), CONTEXT).mustNotCiteHits).toBe(0);
  });

  it('works out the share of cited sources that are the assistant’s own reading', () => {
    const score = scoreCase(
      makeCase(),
      makeResult({
        sources: [
          { ...PAGE },
          { ...FILE, inferred: true },
          { ...FILE, path: 'b.js', inferred: true },
          { ...PAGE, id: '2' },
        ],
      }),
      CONTEXT,
    );

    expect(score.inferredShare).toBe(0.5);
  });

  it('has no inferred share when nothing was cited', () => {
    expect(scoreCase(makeCase(), makeResult(), CONTEXT).inferredShare).toBeUndefined();
  });
});

describe('scoreCase: confidence limit', () => {
  const limited = expecting({ maxConfidence: 'medium' });

  it.each([
    ['high', false],
    ['medium', true],
    ['low', true],
    [null, true],
  ])('says whether %s respects a limit of medium: %s', (confidence, respected) => {
    const score = scoreCase(
      limited,
      makeResult({ confidence: /** @type {any} */ (confidence) }),
      CONTEXT,
    );

    expect(score.maxConfidenceRespected).toBe(respected);
  });

  it('fails the case when the limit is exceeded', () => {
    expect(scoreCase(limited, makeResult({ confidence: 'high' }), CONTEXT).passed).toBe(false);
  });

  it('does not apply when the case sets no limit', () => {
    expect(
      scoreCase(makeCase(), makeResult({ confidence: 'high' }), CONTEXT).maxConfidenceRespected,
    ).toBeUndefined();
  });
});

describe('scoreCase: style', () => {
  const problems = ['it contains a code block'];

  it('counts the style problems left after the rewrite', () => {
    const score = scoreCase(makeCase(), makeResult({ styleViolations: problems }), {
      depth: 2,
      maxToolCalls: 12,
    });

    expect(score.styleViolations).toBe(1);
  });

  it('counts them as plain-style violations, and fails the case, for a depth 1 role', () => {
    const score = scoreCase(makeCase(), makeResult({ styleViolations: problems }), {
      depth: 1,
      maxToolCalls: 12,
    });

    expect(score).toMatchObject({ plainStyleViolations: 1, passed: false });
  });

  it('does not count them as plain-style violations for a more technical role', () => {
    const score = scoreCase(makeCase(), makeResult({ styleViolations: problems }), {
      depth: 3,
      maxToolCalls: 12,
    });

    expect(score).toMatchObject({ plainStyleViolations: 0, passed: true });
  });
});

describe('scoreCase: the answer’s own checks', () => {
  it('flags a missing report of confidence as a meta error', () => {
    const score = scoreCase(
      makeCase(),
      makeResult({ capsApplied: [{ code: 'no-meta' }] }),
      CONTEXT,
    );

    expect(score.metaError).toBe(true);
  });

  it('notes a report that was got by asking again, and then it is no meta error', () => {
    const score = scoreCase(makeCase(), makeResult({ metaRepaired: true }), CONTEXT);

    expect(score).toMatchObject({ metaRepaired: true, metaError: false });
  });

  it('says a report was not asked for again when the result does not say, as in older results', () => {
    expect(scoreCase(makeCase(), makeResult(), CONTEXT).metaRepaired).toBe(false);
  });

  it('does not flag other rules as a meta error', () => {
    const score = scoreCase(makeCase(), makeResult({ capsApplied: [{ code: 'gaps' }] }), CONTEXT);

    expect(score.metaError).toBe(false);
  });

  it('counts invalid keys and uncited sentences', () => {
    const score = scoreCase(
      makeCase(),
      makeResult({ invalidKeys: ['C9', 'G7'], uncitedSentences: ['One.', 'Two.', 'Three.'] }),
      CONTEXT,
    );

    expect(score).toMatchObject({ invalidKeys: 2, uncitedSentences: 3 });
  });

  it('records a rewrite, and a rewrite that was not used', () => {
    const score = scoreCase(
      makeCase(),
      makeResult({ rewritten: true, rewriteRejected: true }),
      CONTEXT,
    );

    expect(score).toMatchObject({ rewritten: true, rewriteRejected: true });
  });

  it('records the time the question took', () => {
    expect(scoreCase(makeCase(), makeResult({ durationMs: 4321 }), CONTEXT).latencyMs).toBe(4321);
  });

  it.each([
    [11, false],
    [12, true],
    [13, true],
  ])('says a question with %i tool calls hit a limit of 12: %s', (count, hit) => {
    const calls = Array.from({ length: count }, () => ({}));

    expect(scoreCase(makeCase(), makeResult({ toolCalls: calls }), CONTEXT).callBudgetHit).toBe(
      hit,
    );
  });
});

describe('scoreCase: passing', () => {
  it('passes when everything that applies passes, even with low citation recall', () => {
    const entry = expecting({ sources: [{ type: 'github', match: 'window.js' }] });

    const score = scoreCase(entry, makeResult({ sources: [PAGE] }), CONTEXT);

    expect(score).toMatchObject({ citationRecall: 0, passed: true });
  });

  it('fails when the status is wrong', () => {
    const score = scoreCase(
      makeCase(),
      makeResult({ status: 'not_found', confidence: null }),
      CONTEXT,
    );

    expect(score.passed).toBe(false);
  });
});

describe('scoreFailure', () => {
  it('records a question that failed as an error that never passes', () => {
    const score = scoreFailure(makeCase({ tags: ['smoke'] }), 5000);

    expect(score).toMatchObject({
      status: ERROR_STATUS,
      statusMatch: false,
      passed: false,
      latencyMs: 5000,
      tags: ['smoke'],
      confidence: null,
    });
  });

  it('counts every expected source as missed', () => {
    const entry = expecting({
      sources: [
        { type: 'github', match: 'a' },
        { type: 'github', match: 'b' },
      ],
    });

    expect(scoreFailure(entry, 1)).toMatchObject({ citationRecall: 0, missedSources: 2 });
  });

  it('has no recall to report when no sources were expected', () => {
    expect(scoreFailure(makeCase(), 1)).toMatchObject({
      citationRecall: undefined,
      missedSources: 0,
    });
  });

  it('does not count as declining when a decline was expected, and is not honest or dishonest', () => {
    const score = scoreFailure(makeCase({ expect: { status: 'not_found', reference: 'r' } }), 1);

    expect(score).toMatchObject({ declinedAppropriately: false, honest: undefined });
  });

  it('has nothing to say about declining for a case that expects an answer', () => {
    expect(scoreFailure(makeCase(), 1).declinedAppropriately).toBeUndefined();
  });
});
