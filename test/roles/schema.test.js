// @ts-check
import { describe, expect, it } from 'vitest';
import { roleSchema } from '../../src/roles/schema.js';

/**
 * A valid role, optionally changed.
 * @param {Record<string, unknown>} [overrides] - Fields to change; undefined removes one.
 * @returns {Record<string, unknown>} The role as parsed YAML would give it.
 */
function role(overrides = {}) {
  const base = {
    id: 'product_owner',
    displayName: 'Product Owner',
    description: 'Plain business language.',
    audience: 'Product owners.',
    depth: 1,
    vocabulary: ['Do use plain words.'],
    bannedTerms: [],
    sourcePriority: ['confluence', 'github'],
    answerShape: ['One-line answer.'],
    examples: [{ question: 'Is it built?', answer: 'Yes [C1].' }],
    version: 1,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined));
}

/**
 * Parses a role and returns the problems as `field: message` strings.
 * @param {Record<string, unknown>} value - The role.
 * @returns {string[]} One entry per problem; empty when valid.
 */
function problems(value) {
  const result = roleSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
}

describe('roleSchema', () => {
  it('accepts a complete role', () => {
    expect(problems(role())).toEqual([]);
  });

  it('accepts an empty bannedTerms list and both source orders', () => {
    expect(problems(role({ sourcePriority: ['github', 'confluence'] }))).toEqual([]);
  });

  it.each([
    'id',
    'displayName',
    'description',
    'audience',
    'depth',
    'vocabulary',
    'bannedTerms',
    'sourcePriority',
    'answerShape',
    'examples',
    'version',
  ])('reports the missing field %s by name', (field) => {
    const [first] = problems(role({ [field]: undefined }));

    expect(first.startsWith(`${field}: `)).toBe(true);
  });

  it.each(['Product Owner', 'product-owner', '1owner', ''])('rejects the id %j', (id) => {
    expect(problems(role({ id })).length).toBeGreaterThan(0);
  });

  it.each([0, 4, 1.5, -1, '2', null])('rejects the depth %j', (depth) => {
    expect(problems(role({ depth }))).toEqual(['depth: must be 1, 2 or 3']);
  });

  it.each([1, 2, 3])('accepts the depth %i', (depth) => {
    expect(problems(role({ depth }))).toEqual([]);
  });

  it('rejects a description that spans several lines', () => {
    expect(problems(role({ description: 'one\ntwo' }))).toEqual([
      'description: must be a single line',
    ]);
  });

  it.each([
    [['confluence']],
    [['github', 'github']],
    [['confluence', 'github', 'web']],
    [[]],
    ['confluence'],
  ])('rejects the source priority %j', (sourcePriority) => {
    expect(problems(role({ sourcePriority }))[0]).toBe(
      'sourcePriority: must be [confluence, github] or [github, confluence]',
    );
  });

  it('requires at least one vocabulary rule and one answer section', () => {
    expect(problems(role({ vocabulary: [], answerShape: [] }))).toEqual([
      'vocabulary: must have at least one entry',
      'answerShape: must have at least one entry',
    ]);
  });

  it('rejects an entry that is blank or not text', () => {
    expect(problems(role({ vocabulary: ['  '] }))).toEqual(['vocabulary.0: must not be empty']);
    expect(problems(role({ bannedTerms: [3] }))).toEqual(['bannedTerms.0: must be text']);
  });

  it('rejects a list that is not a list', () => {
    expect(problems(role({ bannedTerms: 'jargon' }))).toEqual(['bannedTerms: must be a list']);
  });

  it('allows one to three examples, no fewer and no more', () => {
    const one = { question: 'q', answer: 'a' };

    expect(problems(role({ examples: [] }))).toEqual(['examples: must have at least one example']);
    expect(problems(role({ examples: [one, one, one] }))).toEqual([]);
    expect(problems(role({ examples: [one, one, one, one] }))).toEqual([
      'examples: must have at most 3 examples',
    ]);
  });

  it('rejects an example without an answer, or with a field it does not know', () => {
    expect(problems(role({ examples: [{ question: 'q' }] }))[0]).toContain('examples.0');
    expect(problems(role({ examples: [{ question: 'q', answer: 'a', extra: 1 }] }))[0]).toContain(
      'examples.0',
    );
  });

  it.each([0, 1.5, -2, '1', null])('rejects the version %j', (version) => {
    expect(problems(role({ version }))).toEqual(['version: must be a whole number from 1']);
  });

  it('rejects a field it does not know, so a misspelling is not silently ignored', () => {
    expect(problems(role({ bannedTerm: ['x'] })).length).toBeGreaterThan(0);
  });

  it('reports a required field that is missing as required', () => {
    expect(problems(role({ displayName: undefined }))).toEqual(['displayName: is required']);
  });
});
