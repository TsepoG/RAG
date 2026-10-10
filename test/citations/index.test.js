// @ts-check
import { describe, expect, it } from 'vitest';
import * as citations from '../../src/citations/index.js';

describe('citations public entry point', () => {
  it('exports the registry, wrapping, labels and validation', () => {
    expect(Object.keys(citations).sort()).toEqual([
      'MAX_CANDIDATES',
      'createCitationRegistry',
      'friendlyLabel',
      'getExtractor',
      'isKeyShaped',
      'removedNotice',
      'validateCitations',
      'wrapAsSource',
    ]);
  });
});
