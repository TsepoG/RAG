// @ts-check

/** @typedef {import('./registry.js').CitationRegistry} CitationRegistry */
/** @typedef {import('./registry.js').Source} Source */
/** @typedef {import('./registry.js').RegisteredSource} RegisteredSource */
/** @typedef {import('./registry.js').Candidate} Candidate */

export { getExtractor, MAX_CANDIDATES, NO_RESULTS } from './extractors/index.js';
export { friendlyLabel } from './labels.js';
export { createCitationRegistry, isKeyShaped } from './registry.js';
export { validateCitations } from './validate.js';
export { removedNotice, wrapAsSource } from './wrap.js';
