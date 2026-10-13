// @ts-check

/** @typedef {import('./meta.js').AnswerMeta} AnswerMeta */
/** @typedef {import('./meta.js').ParsedAnswer} ParsedAnswer */
/** @typedef {import('./caps.js').CapsResult} CapsResult */
/** @typedef {import('./caps.js').Confidence} Confidence */
/** @typedef {import('./caps.js').AnswerStatus} AnswerStatus */
/** @typedef {import('./whoToAsk.js').WhoToAsk} WhoToAsk */
/** @typedef {import('./render.js').RenderableResult} RenderableResult */
/** @typedef {import('./render.js').RenderedAnswer} RenderedAnswer */
/** @typedef {import('./render.js').RenderRole} RenderRole */

export { ANSWER_STATUSES, answerMetaSchema, CONFIDENCE_LEVELS, parseAnswerMeta } from './meta.js';
export {
  findUncitedSentences,
  markCitationsAsInferred,
  MAX_REPORTED_LENGTH,
  MAX_UNCITED_SENTENCES,
  sentencesCitingOnly,
} from './sentences.js';
export {
  applyConfidenceCaps,
  applySourceChangeCap,
  NO_META_REASON,
  SOURCE_CHANGED_CODE,
  SOURCE_CHANGED_REASON,
} from './caps.js';
export { findCitationBrackets } from './prose.js';
export { buildWhoToAsk, MAX_PEOPLE } from './whoToAsk.js';
export { DEFAULT_PHRASES, MAX_CLOSEST_PAGES, renderFinalAnswer, SECTION_TITLES } from './render.js';
