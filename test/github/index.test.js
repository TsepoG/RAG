// @ts-check
import { describe, expect, it } from 'vitest';
import * as github from '../../src/github/index.js';

describe('github public entry point', () => {
  it('exports the commit resolver', () => {
    expect(Object.keys(github)).toEqual(['createCommitResolver']);
  });
});
