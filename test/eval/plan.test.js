// @ts-check
import { describe, expect, it } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { planRun } from '../../src/eval/plan.js';
import { makeCase } from '../helpers/eval.js';

const turn = {
  question: 'Then?',
  expect: { status: /** @type {const} */ ('answered'), reference: 'r' },
};
const single = makeCase({ id: 'single' });
const talk = makeCase({ id: 'talk', followUps: [turn, turn] });

describe('planRun', () => {
  it('runs every case as a conversation, whatever its length', () => {
    expect(planRun([single, talk], { path: 'conversation', maxTurns: 5 })).toEqual({
      runnable: [single, talk],
      skipped: [],
    });
  });

  it('leaves out a conversation case when asking single questions, and names it', () => {
    expect(planRun([single, talk], { path: 'single', maxTurns: 5 })).toEqual({
      runnable: [single],
      skipped: ['talk'],
    });
  });

  it('refuses a case with more turns than a conversation may have, naming it', () => {
    expect(() => planRun([single, talk], { path: 'conversation', maxTurns: 2 })).toThrow(
      new EvalError(
        'These cases have more turns than a conversation may have (CONVERSATION_MAX_TURNS is 2): talk',
      ),
    );
  });

  it('accepts a case with exactly as many turns as a conversation may have', () => {
    expect(planRun([talk], { path: 'conversation', maxTurns: 3 }).runnable).toEqual([talk]);
  });

  it('does not mind the turn cap when asking single questions', () => {
    expect(planRun([talk], { path: 'single', maxTurns: 1 }).skipped).toEqual(['talk']);
  });
});
