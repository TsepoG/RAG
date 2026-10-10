// @ts-check
import { describe, expect, it } from 'vitest';
import { createCitationRegistry } from '../../src/citations/registry.js';
import { validateCitations } from '../../src/citations/validate.js';
import { confluenceSource, githubSource } from '../helpers/sources.js';

/**
 * Builds a registry holding C1, C2, G1 and G2.
 * @returns {ReturnType<typeof createCitationRegistry>} The registry.
 */
function registry() {
  const sources = createCitationRegistry();
  sources.register(confluenceSource({ id: '1' }));
  sources.register(confluenceSource({ id: '2' }));
  sources.register(githubSource({ path: 'a.js' }));
  sources.register(githubSource({ path: 'b.js' }));
  return sources;
}

describe('validateCitations valid keys', () => {
  it('keeps registered keys and leaves the answer as it is', () => {
    const answer = 'Refunds take 30 days [C1]. Large ones need approval [C2][G1].';

    expect(validateCitations(answer, registry())).toMatchObject({
      answer,
      citedKeys: ['C1', 'C2', 'G1'],
      invalidKeys: [],
    });
  });

  it('handles a key at the end of a sentence, in a heading and in a list', () => {
    const answer = '# Policy [C1]\n- One rule [G2]\n- Another [C2]';

    expect(validateCitations(answer, registry()).answer).toBe(answer);
  });

  it('reports each key once, in order of first use, however often it is repeated', () => {
    const result = validateCitations('A [G1]. B [C1]. C [G1]. D [C1][G1].', registry());

    expect(result.citedKeys).toEqual(['G1', 'C1']);
  });

  it('leaves an answer with no citations alone', () => {
    expect(validateCitations('Nothing was found.', registry())).toEqual({
      answer: 'Nothing was found.',
      citedKeys: [],
      invalidKeys: [],
      uncitedSourceKeys: ['C1', 'C2', 'G1', 'G2'],
    });
  });

  it('validates an empty answer', () => {
    expect(validateCitations('', registry()).answer).toBe('');
  });
});

describe('validateCitations invented keys', () => {
  it('removes a key that is not registered and reports it', () => {
    const result = validateCitations('Refunds take 30 days [C9].', registry());

    expect(result).toMatchObject({
      answer: 'Refunds take 30 days.',
      citedKeys: [],
      invalidKeys: ['C9'],
    });
  });

  it('removes only the invented key from a run of adjacent keys', () => {
    expect(validateCitations('Rule [C1][C9][G1].', registry())).toMatchObject({
      answer: 'Rule [C1][G1].',
      citedKeys: ['C1', 'G1'],
      invalidKeys: ['C9'],
    });
  });

  it('removes a key whose letter is right but whose number is not registered', () => {
    expect(validateCitations('Rule [G3].', registry()).invalidKeys).toEqual(['G3']);
  });

  it('reports each invented key once, in order of first use', () => {
    const result = validateCitations('A [C9]. B [G8]. C [C9].', registry());

    expect(result.invalidKeys).toEqual(['C9', 'G8']);
    expect(result.answer).toBe('A. B. C.');
  });

  it('removes the space before a removed key so no gap is left', () => {
    expect(validateCitations('One [C9] two [C9] three', registry()).answer).toBe('One two three');
  });

  it('keeps a key at the very start of the answer when it is valid, and drops it when not', () => {
    expect(validateCitations('[C1] Start', registry()).answer).toBe('[C1] Start');
    expect(validateCitations('[C9] Start', registry()).answer).toBe(' Start');
  });

  it('does not treat a candidate, or a key from another question, as registered', () => {
    const other = createCitationRegistry();
    other.register(confluenceSource({ id: '77' }));
    const mine = createCitationRegistry();

    expect(validateCitations('Claim [C1].', mine).invalidKeys).toEqual(['C1']);
  });
});

describe('validateCitations combined brackets', () => {
  it.each(['[C1, G2]', '[C1,G2]', '[C1 ,  G2]', '[ C1, G2 ]'])(
    'writes %s as separate brackets',
    (combined) => {
      const result = validateCitations(`Rule ${combined}.`, registry());

      expect(result).toMatchObject({ answer: 'Rule [C1][G2].', citedKeys: ['C1', 'G2'] });
    },
  );

  it('strips an invalid key inside a combined bracket and keeps the valid ones', () => {
    const result = validateCitations('Rule [C1, C9, G1].', registry());

    expect(result).toMatchObject({
      answer: 'Rule [C1][G1].',
      citedKeys: ['C1', 'G1'],
      invalidKeys: ['C9'],
    });
  });

  it('removes a combined bracket whose keys are all invented', () => {
    expect(validateCitations('Rule [C8, C9].', registry())).toMatchObject({
      answer: 'Rule.',
      invalidKeys: ['C8', 'C9'],
    });
  });

  it('writes a repeated key inside one bracket once', () => {
    expect(validateCitations('Rule [C1, C1].', registry()).answer).toBe('Rule [C1].');
  });
});

describe('validateCitations other brackets', () => {
  it.each([
    'See [the docs] for more.',
    'Items [1, 2, 3] are fine.',
    'Odd [C1, note] bracket.',
    'Empty [] and blank [ ] brackets.',
    'A trailing comma [C1,] is left alone.',
    'Lowercase [c1] is not a key.',
    'A link [text](https://example.com) stays.',
  ])('leaves %j alone', (answer) => {
    expect(validateCitations(answer, registry())).toMatchObject({
      answer,
      citedKeys: [],
      invalidKeys: [],
    });
  });
});

describe('validateCitations uncited sources', () => {
  it('lists registered sources the answer never cites, in key order', () => {
    const result = validateCitations('Only one [G1] and [C2].', registry());

    expect(result.uncitedSourceKeys).toEqual(['C1', 'G2']);
  });

  it('lists none when every source is cited', () => {
    const result = validateCitations('[C1][C2][G1][G2]', registry());

    expect(result.uncitedSourceKeys).toEqual([]);
  });

  it('does not count a removed invented key as a citation of anything', () => {
    expect(validateCitations('Claim [C9].', registry()).uncitedSourceKeys).toEqual([
      'C1',
      'C2',
      'G1',
      'G2',
    ]);
  });
});
