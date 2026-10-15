// @ts-check

/** @typedef {import('./api.js').GithubApi} GithubApi */
/** @typedef {import('./codeowners.js').CodeownersLookup} CodeownersLookup */
/** @typedef {import('./codeowners.js').CodeownersRule} CodeownersRule */

export { createGithubApi, describeFailure, isNotFound } from './api.js';
export { createCodeownersLookup, matchOwners, parseCodeowners } from './codeowners.js';
export { createCommitResolver } from './commits.js';
