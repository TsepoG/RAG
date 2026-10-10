// @ts-check
import { describe, expect, it } from 'vitest';
import { ASK_USAGE, DEFAULT_ROLE_ID, parseAskArguments } from '../../src/answer/args.js';
import { AppError } from '../../src/errors/index.js';

/**
 * Runs the parser on arguments that should be refused and returns the error.
 * @param {string[]} argv - The arguments.
 * @returns {AppError} The error it threw.
 */
function refused(argv) {
  try {
    parseAskArguments(argv);
  } catch (error) {
    return /** @type {AppError} */ (error);
  }
  throw new Error('expected the arguments to be refused');
}

describe('parseAskArguments', () => {
  it('reads a question with no role', () => {
    expect(parseAskArguments(['How do refunds work?'])).toEqual({
      question: 'How do refunds work?',
      role: undefined,
    });
  });

  it.each([
    [['--role', 'product_owner', 'Is it built?']],
    [['Is it built?', '--role', 'product_owner']],
    [['--role=product_owner', 'Is it built?']],
    [['-r', 'product_owner', 'Is it built?']],
  ])('reads the role and question from %j', (argv) => {
    expect(parseAskArguments(argv)).toEqual({ question: 'Is it built?', role: 'product_owner' });
  });

  it('joins the words of an unquoted question', () => {
    expect(parseAskArguments(['--role', 'qa', 'Is', 'it', 'built?'])).toEqual({
      question: 'Is it built?',
      role: 'qa',
    });
  });

  it.each([
    [[], undefined],
    [['--role', 'qa'], 'qa'],
    [['   '], undefined],
  ])('gives an empty question for %j', (argv, role) => {
    expect(parseAskArguments(argv)).toEqual({ question: '', role });
  });

  it('trims the question', () => {
    expect(parseAskArguments(['  spaced out  ']).question).toBe('spaced out');
  });

  it.each([[['--unknown', 'q']], [['--role']], [['-x', 'q']]])(
    'refuses %j with the usage, keeping the cause',
    (argv) => {
      const error = refused(argv);

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe(ASK_USAGE);
      expect(error.cause).toBeInstanceOf(Error);
    },
  );

  it('uses developer as the default role, and the usage mentions --role', () => {
    expect(DEFAULT_ROLE_ID).toBe('developer');
    expect(ASK_USAGE).toContain('--role');
  });
});
