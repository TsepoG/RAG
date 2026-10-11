// @ts-check

/** @typedef {import('./meta.js').AnswerMeta} AnswerMeta */
/** @typedef {import('./meta.js').ParsedAnswer} ParsedAnswer */
/** @typedef {import('./caps.js').CapsResult} CapsResult */
/** @typedef {import('./caps.js').Confidence} Confidence */
/** @typedef {import('./caps.js').AnswerStatus} AnswerStatus */
/** @typedef {import('./whoToAsk.js').WhoToAsk} WhoToAsk */

export { ANSWER_STATUSES, answerMetaSchema, CONFIDENCE_LEVELS, parseAnswerMeta } from './meta.js';
export {
  findUncitedSentences,
  markCitationsAsInferred,
  MAX_REPORTED_LENGTH,
  MAX_UNCITED_SENTENCES,
  sentencesCitingOnly,
} from './sentences.js';
export { applyConfidenceCaps, NO_META_REASON } from './caps.js';
export { findCitationBrackets } from './prose.js';
export { buildWhoToAsk, MAX_PEOPLE } from './whoToAsk.js';
