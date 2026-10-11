// @ts-check
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHRASES,
  MAX_CLOSEST_PAGES,
  renderFinalAnswer,
  SECTION_TITLES,
} from '../../src/honesty/index.js';

const CONFLICT = {
  topic: 'Refund window',
  docSays: '30 days.',
  docKeys: ['C1'],
  codeSays: '14 days',
  codeKeys: ['G2'],
};
const PAGES = Array.from({ length: 7 }, (_, index) => ({
  key: index === 0 ? 'C3' : undefined,
  title: `Page ${index}`,
  url: `https://acme.atlassian.net/wiki/spaces/ENG/pages/${index}`,
}));
const PEOPLE = [{ name: '@acme/payments', sourceKeys: ['G1'] }];

/**
 * Builds a result, answered with high confidence unless a test says otherwise.
 * @param {Record<string, unknown>} [changes] - Fields to change.
 * @returns {import('../../src/honesty/index.js').RenderableResult} The result.
 */
function result(changes = {}) {
  return {
    status: 'answered',
    confidence: 'high',
    answer: '  Refunds take 30 days [C1].\n',
    gaps: ['No page covers partial refunds'],
    conflicts: [],
    alsoConsulted: PAGES,
    whoToAsk: PEOPLE,
    ...changes,
  };
}

describe('renderFinalAnswer banners', () => {
  it.each(['high', 'medium', 'low'])('shows the default banner for %s confidence', (confidence) => {
    const rendered = renderFinalAnswer(result({ confidence }), {});

    expect(rendered.banner).toBe(DEFAULT_PHRASES[/** @type {'high'} */ (confidence)]);
    expect(rendered.level).toBe(confidence);
  });

  it('uses the words of the role where it has its own, and the default for the rest', () => {
    const role = { phrases: { low: 'Not sure, sorry.' } };

    expect(renderFinalAnswer(result({ confidence: 'low' }), role).banner).toBe('Not sure, sorry.');
    expect(renderFinalAnswer(result({ confidence: 'high' }), role).banner).toBe(
      DEFAULT_PHRASES.high,
    );
  });

  it('shows the not-found text as the banner and nothing else in the text', () => {
    const rendered = renderFinalAnswer(result({ status: 'not_found', confidence: null }), {});

    expect(rendered).toMatchObject({ banner: DEFAULT_PHRASES.notFound, text: '', level: null });
  });

  it('shows the out-of-scope text as the banner, with no sources or help', () => {
    const rendered = renderFinalAnswer(result({ status: 'out_of_scope', confidence: null }), {
      phrases: { outOfScope: 'That is not something I know.' },
    });

    expect(rendered).toEqual({
      level: null,
      banner: 'That is not something I know.',
      text: '',
      conflicts: [],
      gaps: [],
      closestPages: [],
      whoToAsk: [],
    });
  });

  it('shows no banner for a clarifying question', () => {
    const rendered = renderFinalAnswer(
      result({
        status: 'clarify',
        confidence: null,
        clarifyingQuestion: 'Which refunds do you mean?',
      }),
      {},
    );

    expect(rendered).toMatchObject({ banner: '', text: 'Which refunds do you mean?', level: null });
  });

  it('shows nothing for a clarify that has no question', () => {
    expect(renderFinalAnswer(result({ status: 'clarify', confidence: null }), {}).text).toBe('');
  });

  it('never calls the default high banner a confirmation by both kinds of source', () => {
    expect(DEFAULT_PHRASES.high).not.toMatch(/documentation and the code/i);
  });
});

describe('renderFinalAnswer the answer text', () => {
  it('shows the answer of an answered question, trimmed', () => {
    expect(renderFinalAnswer(result(), {}).text).toBe('Refunds take 30 days [C1].');
  });

  it.each(['not_found', 'out_of_scope'])('discards what the model wrote for %s', (status) => {
    const rendered = renderFinalAnswer(
      result({ status, confidence: null, answer: 'A guess.' }),
      {},
    );

    expect(JSON.stringify(rendered)).not.toContain('A guess.');
  });
});

describe('renderFinalAnswer gaps', () => {
  it.each(['medium', 'low'])(
    'lists what could not be confirmed for %s confidence',
    (confidence) => {
      expect(renderFinalAnswer(result({ confidence }), {}).gaps).toEqual([
        'No page covers partial refunds',
      ]);
    },
  );

  it('leaves the gaps out of a high-confidence answer', () => {
    expect(renderFinalAnswer(result({ confidence: 'high' }), {}).gaps).toEqual([]);
  });

  it('leaves the gaps out of a not-found answer', () => {
    expect(renderFinalAnswer(result({ status: 'not_found', confidence: null }), {}).gaps).toEqual(
      [],
    );
  });

  it('gives a copy, so changing it does not change the result', () => {
    const value = result({ confidence: 'low' });

    renderFinalAnswer(value, {}).gaps.push('x');

    expect(value.gaps).toEqual(['No page covers partial refunds']);
  });
});

describe('renderFinalAnswer conflicts', () => {
  it('writes each disagreement from the structured report, with both keys', () => {
    const rendered = renderFinalAnswer(result({ confidence: 'low', conflicts: [CONFLICT] }), {});

    expect(rendered.conflicts).toEqual([
      'Refund window: the documentation says 30 days [C1]; the code does 14 days [G2]. The code reflects current behaviour.',
    ]);
  });

  it('writes several, in order, and copes with a side that has no key', () => {
    const rendered = renderFinalAnswer(
      result({
        confidence: 'low',
        conflicts: [
          CONFLICT,
          { ...CONFLICT, topic: 'Limit:', docKeys: [], codeKeys: ['G1', 'G3'] },
        ],
      }),
      {},
    );

    expect(rendered.conflicts).toHaveLength(2);
    expect(rendered.conflicts[1]).toBe(
      'Limit: the documentation says 30 days; the code does 14 days [G1][G3]. The code reflects current behaviour.',
    );
  });

  it('shows none when there are none', () => {
    expect(renderFinalAnswer(result(), {}).conflicts).toEqual([]);
  });

  it('does not show conflicts with a not-found answer', () => {
    const rendered = renderFinalAnswer(
      result({ status: 'not_found', confidence: null, conflicts: [CONFLICT] }),
      {},
    );

    expect(rendered.conflicts).toEqual([]);
  });
});

describe('renderFinalAnswer closest pages', () => {
  it('lists at most five of the pages looked at, for a not-found answer', () => {
    const rendered = renderFinalAnswer(result({ status: 'not_found', confidence: null }), {});

    expect(rendered.closestPages).toHaveLength(MAX_CLOSEST_PAGES);
    expect(rendered.closestPages[0]).toEqual(PAGES[0]);
  });

  it.each([
    ['an answered question', {}],
    ['an out-of-scope question', { status: 'out_of_scope', confidence: null }],
  ])('lists none for %s', (_name, changes) => {
    expect(renderFinalAnswer(result(changes), {}).closestPages).toEqual([]);
  });

  it('lists none when nothing else was looked at', () => {
    expect(
      renderFinalAnswer(result({ status: 'not_found', confidence: null, alsoConsulted: [] }), {})
        .closestPages,
    ).toEqual([]);
  });
});

describe('renderFinalAnswer who to ask', () => {
  it.each([
    ['not found', { status: 'not_found', confidence: null }],
    ['medium confidence', { confidence: 'medium' }],
    ['low confidence', { confidence: 'low' }],
  ])('suggests people for %s', (_name, changes) => {
    expect(renderFinalAnswer(result(changes), {}).whoToAsk).toEqual(PEOPLE);
  });

  it.each([
    ['high confidence', {}],
    ['out of scope', { status: 'out_of_scope', confidence: null }],
    ['a clarifying question', { status: 'clarify', confidence: null }],
  ])('suggests nobody for %s', (_name, changes) => {
    expect(renderFinalAnswer(result(changes), {}).whoToAsk).toEqual([]);
  });

  it('suggests nobody when there is nobody', () => {
    expect(renderFinalAnswer(result({ confidence: 'low', whoToAsk: [] }), {}).whoToAsk).toEqual([]);
  });
});

describe('section titles', () => {
  it('are fixed text both the terminal and the web page use', () => {
    expect(SECTION_TITLES).toEqual({
      gaps: "What I couldn't confirm",
      closestPages: 'Closest pages I checked',
      whoToAsk: 'Who might know',
    });
  });
});
