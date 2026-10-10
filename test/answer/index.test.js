// @ts-check
import { describe, expect, it } from 'vitest';
import * as answer from '../../src/answer/index.js';

describe('answer public entry point', () => {
  it('exports askQuestion and the argument summariser', () => {
    expect(Object.keys(answer).sort()).toEqual(['askQuestion', 'summarizeArguments']);
  });
});
