// @ts-check
import { describe, expect, it } from 'vitest';
import * as github from '../../src/github/index.js';

describe('github public entry point', () => {
  it('exports the GitHub client, the commit resolver and the CODEOWNERS reader', () => {
    expect(Object.keys(github).sort()).toEqual([
      'createCodeownersLookup',
      'createCommitResolver',
      'createGithubApi',
      'describeFailure',
      'isNotFound',
      'matchOwners',
      'parseCodeowners',
    ]);
  });
});
