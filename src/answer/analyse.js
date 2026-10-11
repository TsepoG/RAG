// @ts-check
import { isKeyShaped, validateCitations } from '../citations/index.js';
import {
  applyConfidenceCaps,
  findUncitedSentences,
  markCitationsAsInferred,
  parseAnswerMeta,
} from '../honesty/index.js';
import { checkStyle } from '../style/index.js';
import { assembleAnswer } from './result.js';

/**
 * Everything worked out from one reply of the model, before anything is shown.
 * @typedef {object} Analysis
 * @property {'missing' | 'invalid-json' | 'invalid-shape' | undefined} metaError - Why the model's
 *   report could not be used, if it could not.
 * @property {'not-at-end' | undefined} warning - Set when text followed the report.
 * @property {import('../honesty/index.js').AnswerMeta | undefined} meta - The model's report, with
 *   the keys of its conflicts checked.
 * @property {import('./result.js').AnswerParts} parts - The checked answer and its sources.
 * @property {string[]} citedKeys - Keys the text of the answer cites.
 * @property {string[]} uncitedSentences - Sentences that make a claim without a citation.
 * @property {import('../honesty/index.js').CapsResult} caps - The final status and confidence.
 * @property {import('../style/index.js').StyleViolation[]} violations - How the text does not
 *   suit the role.
 */

/** @typedef {import('../citations/index.js').CitationRegistry} Registry */

/**
 * Whether a key is a folder listing. A sentence resting on nothing else is an interpretation.
 * @param {Registry} registry - The question's sources.
 * @returns {(key: string) => boolean} The test.
 */
function folderKeyTest(registry) {
  return (key) => {
    const source = registry.get(key);
    return source?.type === 'github' && source.kind === 'directory';
  };
}

/**
 * Checks the keys of the conflicts the model reported. A key that was never given out is dropped
 * and reported, like one in the text; a conflict left with no key on either side is dropped.
 * @param {import('../honesty/index.js').AnswerMeta | undefined} meta - The model's report.
 * @param {Registry} registry - The question's sources.
 * @returns {{ meta: import('../honesty/index.js').AnswerMeta | undefined, invalidKeys: string[], conflictKeys: string[] }}
 *   The report with checked conflicts, the invented keys, and the real keys the conflicts cite.
 */
function checkConflictKeys(meta, registry) {
  /** @type {string[]} */
  const invalidKeys = [];
  /** @type {string[]} */
  const conflictKeys = [];
  if (meta === undefined) {
    return { meta, invalidKeys, conflictKeys };
  }
  /**
   * Keeps the keys that were given out.
   * @param {string[]} keys - Keys as the model wrote them.
   * @returns {string[]} The real ones.
   */
  const real = (keys) =>
    keys.filter((key) => {
      if (registry.get(key) !== undefined) {
        conflictKeys.push(key);
        return true;
      }
      if (isKeyShaped(key)) {
        invalidKeys.push(key);
      }
      return false;
    });
  const conflicts = meta.conflicts
    .map((conflict) => ({
      ...conflict,
      docKeys: real(conflict.docKeys),
      codeKeys: real(conflict.codeKeys),
    }))
    .filter(({ docKeys, codeKeys }) => docKeys.length + codeKeys.length > 0);
  return { meta: { ...meta, conflicts }, invalidKeys, conflictKeys };
}

/**
 * Lists distinct values, first use first.
 * @param {ReadonlyArray<string>} values - Values that may repeat.
 * @returns {string[]} Each value once.
 */
function distinct(values) {
  return [...new Set(values)];
}

/**
 * Works out everything about one reply: the model's report, which citations are real, which
 * sentences rest on folder listings alone, and what the final status and confidence are. It makes
 * no request and changes nothing, so the same function judges the first answer and a rewrite.
 * @param {{ reply: string, role: import('../roles/index.js').Role, registry: Registry }} input
 *   The model's whole reply, the role, and the question's sources.
 * @returns {Analysis} What was found.
 */
export function analyseReply({ reply, role, registry }) {
  const parsed = parseAnswerMeta(reply);
  const stripped = assembleAnswer({ answer: parsed.answer, role, registry });
  const marked = markCitationsAsInferred(stripped.answer, folderKeyTest(registry));
  const conflicts = checkConflictKeys(parsed.meta, registry);
  const parts = assembleAnswer({
    answer: marked.answer,
    role,
    registry,
    alsoCite: conflicts.conflictKeys,
  });
  const invalidKeys = distinct([...stripped.invalidKeys, ...conflicts.invalidKeys]);
  const checked = validateCitations(marked.answer, registry);
  const uncitedSentences = findUncitedSentences(marked.answer);
  return {
    metaError: parsed.metaError,
    warning: parsed.warning,
    meta: conflicts.meta,
    parts: { ...parts, invalidKeys },
    citedKeys: checked.citedKeys,
    uncitedSentences,
    caps: applyConfidenceCaps({
      meta: conflicts.meta,
      validation: { citedKeys: checked.citedKeys, invalidKeys, inferredKeys: checked.inferredKeys },
      sources: parts.sources,
      folderOnlySentences: marked.sentences,
      uncitedSentences,
    }),
    violations: checkStyle(marked.answer, role),
  };
}
