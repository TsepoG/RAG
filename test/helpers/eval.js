// @ts-check

/**
 * A valid eval case.
 * @param {Partial<import('../../src/eval/schema.js').EvalCase>} [changes] - Fields to replace.
 * @returns {import('../../src/eval/schema.js').EvalCase} The case.
 */
export function makeCase(changes = {}) {
  return {
    id: 'dev-refund',
    role: 'developer',
    question: 'Where is the refund window enforced?',
    tags: [],
    draft: false,
    expect: { status: 'answered', reference: 'In window.js.' },
    ...changes,
  };
}

/**
 * An answer, as `askQuestion` returns it, reduced to what scoring uses.
 * @param {Partial<import('../../src/eval/score.js').ScorableResult>} [changes] - Fields to replace.
 * @returns {import('../../src/eval/score.js').ScorableResult} The answer.
 */
export function makeResult(changes = {}) {
  return {
    status: 'answered',
    confidence: 'medium',
    capsApplied: [],
    sources: [],
    invalidKeys: [],
    uncitedSentences: [],
    styleViolations: [],
    rewritten: false,
    rewriteRejected: false,
    toolCalls: [{}, {}],
    durationMs: 1000,
    ...changes,
  };
}

/**
 * A score for one case.
 * @param {Partial<import('../../src/eval/score.js').CaseScore>} [changes] - Fields to replace.
 * @returns {import('../../src/eval/score.js').CaseScore} The score.
 */
export function makeScore(changes = {}) {
  return {
    id: 'dev-refund',
    role: 'developer',
    tags: [],
    expectedStatus: 'answered',
    status: 'answered',
    confidence: 'medium',
    statusMatch: true,
    declinedAppropriately: undefined,
    honest: undefined,
    citationRecall: undefined,
    missedSources: 0,
    mustNotCiteHits: 0,
    maxConfidenceRespected: undefined,
    styleViolations: 0,
    plainStyleViolations: 0,
    metaError: false,
    metaRepaired: false,
    metaRepairRejected: false,
    invalidKeys: 0,
    uncitedSentences: 0,
    inferredShare: undefined,
    rewritten: false,
    rewriteRejected: false,
    callBudgetHit: false,
    latencyMs: 1000,
    passed: true,
    ...changes,
  };
}

/**
 * What a run was tied to, and what it used.
 * @param {Partial<import('../../src/eval/results.js').RunHeader>} [changes] - Fields to replace.
 * @returns {import('../../src/eval/results.js').RunHeader} The header.
 */
export function makeHeader(changes = {}) {
  return {
    startedAt: '2026-10-11T18:00:00.000Z',
    commit: 'abc123def456',
    dirty: false,
    model: 'gpt-x',
    roles: { developer: 2, qa: 3 },
    basePromptHash: '0123456789ab',
    models: ['gpt-x'],
    requests: { used: 14, casesRun: 8, stoppedEarly: false },
    interrupted: false,
    ...changes,
  };
}
