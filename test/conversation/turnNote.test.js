// @ts-check
import { describe, expect, it } from 'vitest';
import { buildTurnNote } from '../../src/conversation/index.js';

describe('buildTurnNote', () => {
  it('has no note for the first turn', () => {
    expect(buildTurnNote({ turn: 1 })).toBe('');
  });

  it('tells a follow-up it may cite earlier keys, fetch again, and end with the answer-meta block', () => {
    const note = buildTurnNote({ turn: 2 });

    expect(note).toContain('Follow-up in the same conversation');
    expect(note).toContain('cite sources already fetched by their keys');
    expect(note).toContain("fetch again if you need content you haven't seen");
    expect(note).toContain('End with the answer-meta block.');
  });

  it('adds the depth note only when more detail was asked for', () => {
    expect(buildTurnNote({ turn: 2, detailLevel: 'default' })).not.toContain('more detail');
    expect(buildTurnNote({ turn: 2, detailLevel: 'more' })).toContain(
      'one step more technically than your last answer',
    );
  });

  it('names the changed keys and asks for them to be read again', () => {
    const note = buildTurnNote({ turn: 3, changedKeys: ['C2', 'G1'] });

    expect(note).toContain('have changed since you read them: C2, G1');
    expect(note).toContain('new versions get new keys');
  });

  it('names no keys when none changed', () => {
    expect(buildTurnNote({ turn: 3, changedKeys: [] })).not.toContain('changed');
  });
});
