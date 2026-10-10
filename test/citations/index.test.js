// @ts-check
import { describe, expect, it } from 'vitest';
import * as citations from '../../src/citations/index.js';

describe('citations public entry point', () => {
  it('exports the registry, wrapping, labels and validation', () => {
    expect(Object.keys(citations).sort()).toEqual([
      'createCitationRegistry',
      'friendlyLabel',
      'isKeyShaped',
      'removedNotice',
      'validateCitations',
      'wrapAsSource',
    ]);
  });
});
