// @ts-check
import { describe, expect, it } from 'vitest';
import * as github from '../../src/github/index.js';

describe('github public entry point', () => {
  it('exports the GitHub client, the commit resolver, the CODEOWNERS reader and the GitHub CLI helpers', () => {
    expect(Object.keys(github).sort()).toEqual([
      'CLI_MISSING',
      'FIXES',
      'GH_TIMEOUT_MS',
      'LOGIN_ARGS',
      'MCP_FIX',
      'TOKEN_ARGS',
      'TOKEN_CACHE_MS',
      'TOKEN_PREFIX_LENGTH',
      'classifyFailure',
      'createCliTokenProvider',
      'createCodeownersLookup',
      'createCommitResolver',
      'createGithubApi',
      'describeFailure',
      'isNotFound',
      'matchOwners',
      'parseAuthStatus',
      'parseCodeowners',
      'recordFailures',
      'runGithubCheck',
    ]);
  });
});
