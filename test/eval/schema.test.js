// @ts-check
import { describe, expect, it } from 'vitest';
import { CASE_TAGS, caseSchema } from '../../src/eval/schema.js';

/**
 * A valid case, with changes.
 * @param {Record<string, unknown>} [changes] - Fields to replace.
 * @param {Record<string, unknown>} [expectChanges] - Fields of `expect` to replace.
 * @returns {Record<string, unknown>} The case.
 */
function aCase(changes = {}, expectChanges = {}) {
  return {
    id: 'po-refund-window',
    role: 'product_owner',
    question: 'How long do customers have to ask for a refund?',
    tags: ['smoke'],
    expect: {
      status: 'answered',
      sources: [{ type: 'confluence', match: 'Refund Policy' }],
      reference: 'Thirty days.',
      ...expectChanges,
    },
    ...changes,
  };
}

/**
 * The messages for the problems in a case.
 * @param {Record<string, unknown>} entry - The case.
 * @returns {string[]} Each problem as `path: message`.
 */
function problems(entry) {
  const result = caseSchema.safeParse(entry);
  return result.success
    ? []
    : result.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
}

describe('caseSchema', () => {
  it('accepts a complete case', () => {
    const result = caseSchema.parse(aCase());

    expect(result).toMatchObject({ id: 'po-refund-window', draft: false, tags: ['smoke'] });
  });

  it('defaults tags to none and draft to false', () => {
    const entry = aCase();
    Reflect.deleteProperty(entry, 'tags');

    expect(caseSchema.parse(entry)).toMatchObject({ tags: [], draft: false });
  });

  it('accepts a draft', () => {
    expect(caseSchema.parse(aCase({ draft: true })).draft).toBe(true);
  });

  it.each(['not_found', 'clarify', 'out_of_scope'])(
    'accepts %s with only a reference',
    (status) => {
      const entry = aCase({}, { status, sources: undefined });

      expect(caseSchema.safeParse(entry).success).toBe(true);
    },
  );

  it('accepts expected sources, sources not to cite and a highest confidence for an answered case', () => {
    const entry = aCase(
      {},
      {
        mustNotCite: [{ type: 'github', match: 'legacy/' }],
        maxConfidence: 'medium',
      },
    );

    expect(caseSchema.safeParse(entry).success).toBe(true);
  });

  it.each(['id', 'role', 'question', 'expect'])('needs %s', (field) => {
    const entry = aCase();
    Reflect.deleteProperty(entry, field);

    expect(problems(entry).length).toBeGreaterThan(0);
  });

  it('needs a reference', () => {
    const entry = aCase({}, { reference: '  ' });

    expect(problems(entry)).toContain('expect.reference: must not be empty');
  });

  it.each(['Has Capitals', 'under_score', '-leading', '', 'a b'])('rejects the id "%s"', (id) => {
    expect(problems(aCase({ id }))[0]).toContain('id:');
  });

  it('rejects a question over 2000 characters, the limit the page and the API use', () => {
    expect(problems(aCase({ question: 'x'.repeat(2001) }))).toContain(
      'question: must be at most 2000 characters',
    );
  });

  it('rejects a blank question', () => {
    expect(problems(aCase({ question: '   ' }))).toContain('question: must not be empty');
  });

  it('rejects a status that does not exist', () => {
    expect(problems(aCase({}, { status: 'maybe' }))[0]).toContain('expect.status: must be one of');
  });

  it('rejects a tag that does not exist, and names the ones that do', () => {
    const [problem] = problems(aCase({ tags: ['smoke', 'speedy'] }));

    expect(problem).toContain('tags.1');
    for (const tag of CASE_TAGS) {
      expect(problem).toContain(tag);
    }
  });

  it('rejects a source of an unknown type', () => {
    const entry = aCase({}, { sources: [{ type: 'jira', match: 'X-1' }] });

    expect(problems(entry)[0]).toContain('expect.sources.0.type: must be confluence or github');
  });

  it('rejects an expected source with no match', () => {
    const entry = aCase({}, { sources: [{ type: 'github', match: '' }] });

    expect(problems(entry)).toContain('expect.sources.0.match: must not be empty');
  });

  it('rejects a confidence that does not exist', () => {
    expect(problems(aCase({}, { maxConfidence: 'certain' })).length).toBeGreaterThan(0);
  });

  it('rejects a field it does not know, so a misspelling is caught', () => {
    expect(problems(aCase({ tag: ['smoke'] })).length).toBeGreaterThan(0);
    expect(problems(aCase({}, { sourcess: [] })).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'sources',
      { sources: [{ type: 'confluence', match: 'X' }] },
      'only an answered case can expect sources to be cited',
    ],
    ['maxConfidence', { maxConfidence: 'low' }, 'only an answered case has a confidence'],
    [
      'mustNotCite',
      { mustNotCite: [{ type: 'github', match: 'x' }] },
      'only an answered case cites anything',
    ],
  ])('rejects %s on a case that is not answered', (field, extra, message) => {
    const entry = aCase({}, { status: 'not_found', sources: undefined, ...extra });

    expect(problems(entry)).toContain(`expect.${field}: ${message}`);
  });
});

describe('caseSchema multi-turn cases', () => {
  const answered = { status: 'answered', reference: 'Thirty days.' };

  /**
   * A conversation case with the given turns.
   * @param {unknown[]} turns - The turns.
   * @param {Record<string, unknown>} [changes] - Fields to replace.
   * @returns {Record<string, unknown>} The case.
   */
  function conversation(turns, changes = {}) {
    return { id: 'po-refund-followup', role: 'product_owner', tags: [], turns, ...changes };
  }

  const turns = [
    { question: 'How long is the refund window?', expect: answered },
    {
      question: 'And for gift cards?',
      expect: {
        ...answered,
        reusesEarlier: true,
        sources: [{ type: 'confluence', match: 'Refund' }],
      },
    },
    {
      question: 'Who signs off exceptions?',
      expect: { status: 'not_found', reference: 'Not found.' },
    },
  ];

  it('is loaded as its first turn, with the others as follow-ups', () => {
    const loaded = caseSchema.parse(conversation(turns));

    expect(loaded).toMatchObject({
      id: 'po-refund-followup',
      question: 'How long is the refund window?',
      expect: answered,
      followUps: [turns[1], turns[2]],
    });
    expect(loaded).not.toHaveProperty('turns');
  });

  it('has no follow-ups when it is an ordinary case', () => {
    expect(caseSchema.parse(aCase())).not.toHaveProperty('followUps');
  });

  it('accepts a conversation of two turns up to ten', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      question: `Question ${index}?`,
      expect: answered,
    }));

    expect(caseSchema.safeParse(conversation(many)).success).toBe(true);
    expect(caseSchema.safeParse(conversation(many.slice(0, 2))).success).toBe(true);
  });

  it('refuses one turn, which is an ordinary case, and more than ten', () => {
    const many = Array.from({ length: 11 }, () => turns[0]);

    expect(problems(conversation([turns[0]]))).toEqual([
      'turns: must have at least 2 turns; write one question as an ordinary case',
    ]);
    expect(problems(conversation(many))).toEqual(['turns: must have at most 10 turns']);
  });

  it('refuses both forms at once, and neither', () => {
    expect(problems(conversation(turns, { question: 'Q?', expect: answered }))).toContain(
      'turns: a case has either question and expect, or turns, not both',
    );
    expect(problems({ id: 'a', role: 'qa' })).toContain(
      'question: a case needs a question and expect, or turns',
    );
  });

  it('needs a question and an expectation together for the single form', () => {
    expect(problems({ id: 'a', role: 'qa', question: 'Q?' })).toContain('expect: is required');
    expect(problems({ id: 'a', role: 'qa', expect: answered })).toContain('question: is required');
  });

  it('checks each turn the way it checks an ordinary case, and says which turn is wrong', () => {
    const bad = [
      turns[0],
      { question: '  ', expect: answered },
      { question: 'Fine?', expect: { status: 'not_found', reference: 'r', maxConfidence: 'low' } },
    ];

    expect(problems(conversation(bad))).toEqual([
      'turns.1.question: must not be empty',
      'turns.2.expect.maxConfidence: only an answered case has a confidence',
    ]);
  });

  it('only lets an answered turn require an earlier source to be reused', () => {
    const bad = [
      turns[0],
      { question: 'Q?', expect: { status: 'clarify', reference: 'r', reusesEarlier: true } },
    ];

    expect(problems(conversation(bad))).toEqual([
      'turns.1.expect.reusesEarlier: only an answered case cites anything',
    ]);
    expect(
      problems(aCase({}, { status: 'not_found', sources: undefined, reusesEarlier: true })),
    ).toEqual(['expect.reusesEarlier: only an answered case cites anything']);
  });

  it('refuses a field it does not know in a turn', () => {
    expect(problems(conversation([turns[0], { ...turns[1], extra: 1 }])).length).toBeGreaterThan(0);
  });
});
