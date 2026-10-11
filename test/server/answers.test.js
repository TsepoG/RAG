// @ts-check
import { describe, expect, it } from 'vitest';
import { createAnswerMemory } from '../../src/server/answers.js';

/**
 * A record with the given question.
 * @param {string} [question] - What was asked.
 * @returns {import('../../src/server/answers.js').AnswerRecord} The record.
 */
function record(question = 'How do refunds work?') {
  return {
    question,
    role: 'po',
    detailLevel: 'default',
    status: 'answered',
    confidence: 'medium',
    citedKeys: ['C1', 'G1'],
    model: 'gpt-x',
  };
}

/**
 * Ids a, b, c...
 * @returns {() => string} The generator.
 */
function counter() {
  let next = 0;
  return () => `id-${next++}`;
}

describe('createAnswerMemory', () => {
  it('gives back what was remembered, under the id it handed out', () => {
    const memory = createAnswerMemory();

    const id = memory.remember(record());

    expect(memory.get(id)).toEqual(record());
  });

  it('hands out a different id each time', () => {
    const memory = createAnswerMemory();

    expect(memory.remember(record())).not.toBe(memory.remember(record()));
  });

  it('uses UUIDs as ids by default', () => {
    const id = createAnswerMemory().remember(record());

    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
  });

  it('knows nothing about an id it did not hand out', () => {
    const memory = createAnswerMemory();
    memory.remember(record());

    expect(memory.get('made-up')).toBeUndefined();
    expect(memory.get('constructor')).toBeUndefined();
  });

  it('forgets the oldest answer once the limit is passed', () => {
    const memory = createAnswerMemory({ limit: 2, newId: counter() });

    const first = memory.remember(record('one'));
    const second = memory.remember(record('two'));
    const third = memory.remember(record('three'));

    expect(memory.get(first)).toBeUndefined();
    expect(memory.get(second)?.question).toBe('two');
    expect(memory.get(third)?.question).toBe('three');
  });

  it('keeps 50 answers by default', () => {
    const memory = createAnswerMemory();
    const ids = Array.from({ length: 51 }, () => memory.remember(record()));

    expect(memory.get(ids[0])).toBeUndefined();
    expect(memory.get(ids[1])).toBeDefined();
  });

  it('keeps its own copy, which cannot be changed afterwards', () => {
    const memory = createAnswerMemory();
    const original = record();
    const id = memory.remember(original);

    original.citedKeys.push('C9');
    const stored = /** @type {any} */ (memory.get(id));

    expect(stored.citedKeys).toEqual(['C1', 'G1']);
    expect(Object.isFrozen(stored)).toBe(true);
  });
});
