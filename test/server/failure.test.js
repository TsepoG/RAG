// @ts-check
import { describe, expect, it } from 'vitest';
import {
  AppError,
  AskTimeoutError,
  CopilotError,
  QuestionCancelledError,
} from '../../src/errors/index.js';
import { describeFailure } from '../../src/server/failure.js';

describe('describeFailure', () => {
  it.each([
    [new AskTimeoutError(1000), 'timeout'],
    [new QuestionCancelledError(), 'cancelled'],
    [new CopilotError('auth failed'), 'copilot'],
    [new AppError('something'), 'internal'],
    [new TypeError('x is not a function'), 'internal'],
    ['a string', 'internal'],
  ])('sorts %s as %s', (error, kind) => {
    expect(describeFailure(error).kind).toBe(kind);
  });

  it('never repeats the error in the message', () => {
    const secret = 'ghp_secret in the Users folder';

    const { message } = describeFailure(new CopilotError(secret, { cause: new Error(secret) }));

    expect(message).not.toContain('ghp_');
    expect(message).not.toContain('Users');
  });

  it('gives a message to show for every kind', () => {
    const errors = [
      new AskTimeoutError(1),
      new QuestionCancelledError(),
      new CopilotError('x'),
      new Error('x'),
    ];

    for (const error of errors) {
      expect(describeFailure(error).message).toMatch(/\.$/);
    }
  });
});
