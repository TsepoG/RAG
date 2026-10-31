// @ts-check

/** @typedef {import('./api.js').GithubApi} GithubApi */
/** @typedef {import('./codeowners.js').CodeownersLookup} CodeownersLookup */
/** @typedef {import('./codeowners.js').CodeownersRule} CodeownersRule */
/** @typedef {import('./cliToken.js').CliTokenProvider} CliTokenProvider */
/** @typedef {import('./cliStatus.js').AuthStatus} CliAuthStatus */
/** @typedef {import('./cliStatus.js').FailureKind} FailureKind */

export { createGithubApi, describeFailure, isNotFound } from './api.js';
export {
  CLI_MISSING,
  FIXES,
  MCP_FIX,
  recordFailures,
  runGithubCheck,
  TOKEN_PREFIX_LENGTH,
} from './check.js';
export { classifyFailure, parseAuthStatus } from './cliStatus.js';
export {
  createCliTokenProvider,
  GH_TIMEOUT_MS,
  LOGIN_ARGS,
  TOKEN_ARGS,
  TOKEN_CACHE_MS,
} from './cliToken.js';
export { createCodeownersLookup, matchOwners, parseCodeowners } from './codeowners.js';
export { createCommitResolver } from './commits.js';
