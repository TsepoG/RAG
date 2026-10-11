// @ts-check
import { renderFinalAnswer } from '../honesty/index.js';
import { MAX_ALSO_CONSULTED } from './result.js';

/**
 * What a question produced, except how it was reached (tool calls, model, time). It is shaped like
 * the final event the web UI will stream.
 * @typedef {object} ComposedResult
 * @property {'answered' | 'not_found' | 'clarify' | 'out_of_scope'} status - The final status.
 * @property {'high' | 'medium' | 'low' | null} confidence - The final level; null unless answered.
 * @property {string} confidenceReason - Why, in the model's words followed by the application's.
 * @property {import('../honesty/index.js').CapsResult['capsApplied']} capsApplied - The rules that
 *   lowered or settled the status and level.
 * @property {string} answer - The text to show: the checked answer; the one clarifying question;
 *   or, for "not found" and "out of scope", the role's own text.
 * @property {string} role - The id of the role it was written for.
 * @property {import('./result.js').CitedSource[]} sources - The sources the answer cites, in key
 *   order; none unless the question was answered.
 * @property {import('./result.js').ConsultedItem[]} alsoConsulted - Sources fetched but not cited
 *   (all of them, for a question that was not answered), then search hits; at most ten.
 * @property {string[]} invalidKeys - Keys the model used that were never given out.
 * @property {string[]} uncitedSourceKeys - Keys of fetched sources the answer did not cite.
 * @property {string[]} inferredKeys - Keys cited with an asterisk (the model's interpretation).
 * @property {string[]} gaps - What the model could not confirm.
 * @property {import('../honesty/index.js').AnswerMeta['conflicts']} conflicts - Where the
 *   documentation and the code disagree.
 * @property {string} [clarifyingQuestion] - The one question to ask, when the status is clarify.
 * @property {string[]} uncitedSentences - Up to five sentences that make a claim without a citation.
 * @property {string[]} styleViolations - How the answer still does not suit the role, if it does not.
 * @property {boolean} rewritten - True when the answer was rewritten for the role.
 * @property {boolean} rewriteRejected - True when a rewrite was tried and not used.
 * @property {string} [rewriteRejectedReason] - Why it was not used.
 * @property {import('../honesty/index.js').WhoToAsk[]} whoToAsk - People worth asking.
 */

/**
 * What happened about the style of the answer.
 * @typedef {object} StyleOutcome
 * @property {boolean} rewritten - Whether a rewrite replaced the answer.
 * @property {boolean} rewriteRejected - Whether a rewrite was tried and not used.
 * @property {string} [rewriteRejectedReason] - Why it was not used.
 * @property {ReadonlyArray<{ message: string }>} violations - What is still wrong with the answer.
 */

/**
 * Whether the reader should be told who to ask: when nothing was found or the answer is unsure.
 * @param {import('../honesty/index.js').CapsResult} caps - The final status and level.
 * @returns {boolean} True for "not found" and for medium and low answers.
 */
export function wantsWhoToAsk({ status, confidence }) {
  return status === 'not_found' || confidence === 'medium' || confidence === 'low';
}

/**
 * Builds the result of a question from what was worked out about its reply. Pure.
 * @param {{
 *   analysis: import('./analyse.js').Analysis,
 *   role: import('../roles/index.js').Role,
 *   whoToAsk: import('../honesty/index.js').WhoToAsk[],
 *   style: StyleOutcome,
 * }} input - The analysis of the final reply, the role, who to ask, and what happened to the style.
 * @returns {ComposedResult} The result.
 */
export function composeResult({ analysis, role, whoToAsk, style }) {
  const { caps, meta, parts } = analysis;
  const answered = caps.status === 'answered';
  // Nothing counts as cited when the question was not answered, so what was fetched is "consulted".
  const consulted = answered
    ? parts.alsoConsulted
    : [
        ...parts.sources.map(({ key, type, title, url }) => ({ key, type, title, url })),
        ...parts.alsoConsulted,
      ].slice(0, MAX_ALSO_CONSULTED);
  const clarifyingQuestion = caps.status === 'clarify' ? meta?.clarifyingQuestion : undefined;
  const composed = {
    status: caps.status,
    confidence: caps.confidence,
    confidenceReason: caps.confidenceReason,
    capsApplied: caps.capsApplied,
    answer: parts.answer,
    role: parts.role,
    sources: answered ? parts.sources : [],
    alsoConsulted: consulted,
    invalidKeys: parts.invalidKeys,
    uncitedSourceKeys: parts.uncitedSourceKeys,
    inferredKeys: parts.inferredKeys,
    gaps: answered ? [...(meta?.gaps ?? [])] : [],
    conflicts: answered ? [...(meta?.conflicts ?? [])] : [],
    ...(clarifyingQuestion === undefined ? {} : { clarifyingQuestion }),
    // The text of an answer that is not shown is not reported either.
    uncitedSentences: answered ? analysis.uncitedSentences : [],
    styleViolations: style.violations.map(({ message }) => message),
    rewritten: style.rewritten,
    rewriteRejected: style.rewriteRejected,
    ...(style.rewriteRejectedReason === undefined
      ? {}
      : { rewriteRejectedReason: style.rewriteRejectedReason }),
    whoToAsk,
  };
  const shown = renderFinalAnswer(composed, role);
  // What the reader sees first and, for "not found" and "out of scope", all they see.
  const text = answered ? parts.answer : (clarifyingQuestion ?? shown.banner);
  return { ...composed, answer: text };
}
