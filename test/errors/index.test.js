// @ts-check
import { describe, expect, it } from 'vitest';
import { AppError, ConfigError } from '../../src/errors/index.js';

describe('AppError', () => {
  it('is an Error carrying its message', () => {
    const error = new AppError('boom');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });

  it('names itself after its class', () => {
    expect(new AppError('boom').name).toBe('AppError');
  });

  it('names itself after a subclass rather than the base class', () => {
    class McpError extends AppError {}

    expect(new McpError('boom').name).toBe('McpError');
  });

  it('keeps the wrapped error as its cause', () => {
    const cause = new Error('root cause');

    const error = new AppError('wrapped', { cause });

    expect(error.cause).toBe(cause);
  });

  it('has no cause property when none is given', () => {
    expect('cause' in new AppError('boom')).toBe(false);
    expect('cause' in new AppError('boom', {})).toBe(false);
  });
});

describe('ConfigError', () => {
  const issues = [
    { path: 'GITHUB_TOKEN', message: 'is required' },
    { path: 'PORT', message: 'must be an integer between 1 and 65535' },
  ];

  it('is an AppError named ConfigError', () => {
    const error = new ConfigError(issues);

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('ConfigError');
  });

  it('exposes the issue list', () => {
    expect(new ConfigError(issues).issues).toEqual(issues);
  });

  it('names every offending variable in the message', () => {
    const { message } = new ConfigError(issues);

    expect(message).toBe(
      [
        'Invalid configuration:',
        '- GITHUB_TOKEN: is required',
        '- PORT: must be an integer between 1 and 65535',
      ].join('\n'),
    );
  });

  it('freezes the issue list and each issue', () => {
    const { issues: stored } = new ConfigError(issues);

    expect(Object.isFrozen(stored)).toBe(true);
    expect(stored.every((issue) => Object.isFrozen(issue))).toBe(true);
  });

  it('is not affected by later changes to the array it was given', () => {
    const input = [{ path: 'PORT', message: 'is invalid' }];
    const error = new ConfigError(input);

    input[0].message = 'changed';
    input.push({ path: 'EXTRA', message: 'added' });

    expect(error.issues).toEqual([{ path: 'PORT', message: 'is invalid' }]);
  });

  it('keeps the wrapped error as its cause', () => {
    const cause = new Error('zod failed');

    expect(new ConfigError(issues, { cause }).cause).toBe(cause);
  });

  it('reports only the headline when there are no issues', () => {
    expect(new ConfigError([]).message).toBe('Invalid configuration:');
  });
});
