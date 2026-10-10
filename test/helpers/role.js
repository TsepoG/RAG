// @ts-check

/**
 * Builds a valid role, optionally changed, for tests that need one without reading `roles/`.
 * @param {Partial<import('../../src/roles/index.js').Role>} [overrides] - Fields to change.
 * @returns {import('../../src/roles/index.js').Role} The role.
 */
export function makeRole(overrides = {}) {
  return Object.freeze({
    id: 'tester',
    displayName: 'Tester',
    description: 'A role for tests.',
    audience: 'People who test things.',
    depth: 2,
    vocabulary: ['Do be clear.', "Don't be vague."],
    bannedTerms: ['jargon'],
    sourcePriority: ['confluence', 'github'],
    answerShape: ['The answer.', 'The evidence.'],
    examples: [{ question: 'Is it built?', answer: 'Yes [C1].' }],
    version: 1,
    ...overrides,
  });
}

/** A role most tests can use. */
export const TEST_ROLE = makeRole();
