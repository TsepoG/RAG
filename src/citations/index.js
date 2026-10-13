// @ts-check

/** @typedef {import('./registry.js').CitationRegistry} CitationRegistry */
/** @typedef {import('./conversationRegistry.js').ConversationRegistry} ConversationRegistry */
/** @typedef {import('./registry.js').Source} Source */
/** @typedef {import('./registry.js').RegisteredSource} RegisteredSource */
/** @typedef {import('./registry.js').Candidate} Candidate */
/** @typedef {import('./validate.js').WrittenKey} WrittenKey */
/** @typedef {import('./validate.js').ValidationResult} ValidationResult */

export { getExtractor, MAX_CANDIDATES, NO_RESULTS } from './extractors/index.js';
export { friendlyLabel } from './labels.js';
export {
  blobFingerprint,
  entriesFingerprint,
  pageFingerprint,
  releaseListFingerprint,
} from './fingerprints.js';
export { createConversationRegistry } from './conversationRegistry.js';
export { createCitationRegistry, isKeyShaped } from './registry.js';
export { parseCitationKeys, validateCitations } from './validate.js';
export { removedNotice, wrapAsSource } from './wrap.js';
