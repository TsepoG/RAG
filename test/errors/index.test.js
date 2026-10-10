// @ts-check
import { describe, expect, it } from 'vitest';
import {
  AppError,
  AskTimeoutError,
  ConfigError,
  CopilotError,
  McpError,
  ToolNotAllowedError,
} from '../../src/errors/index.js';

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

describe.each([
  ['CopilotError', CopilotError],
  ['McpError', McpError],
])('%s', (name, ErrorClass) => {
  it('is an AppError carrying its message', () => {
    const error = new ErrorClass('upstream failed');

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('upstream failed');
  });

  it('names itself after its class', () => {
    expect(new ErrorClass('upstream failed').name).toBe(name);
  });

  it('keeps the wrapped error as its cause', () => {
    const cause = new Error('socket hang up');

    expect(new ErrorClass('upstream failed', { cause }).cause).toBe(cause);
  });
});

describe('ToolNotAllowedError', () => {
  it('is an AppError named ToolNotAllowedError', () => {
    const error = new ToolNotAllowedError('github_repos', 'create_issue');

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('ToolNotAllowedError');
  });

  it('records the server and tool it refused', () => {
    const error = new ToolNotAllowedError('github_repos', 'create_issue');

    expect(error.server).toBe('github_repos');
    expect(error.tool).toBe('create_issue');
  });

  it('names the server and tool in the message', () => {
    expect(new ToolNotAllowedError('atlassian', 'createPage').message).toBe(
      'Tool "createPage" on server "atlassian" is not allowed',
    );
  });

  it('keeps the wrapped error as its cause', () => {
    const cause = new Error('lookup failed');

    expect(new ToolNotAllowedError('atlassian', 'createPage', { cause }).cause).toBe(cause);
  });
});

describe('AskTimeoutError', () => {
  it('is an AppError named AskTimeoutError', () => {
    const error = new AskTimeoutError(120_000);

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AskTimeoutError');
  });

  it('records the limit that was exceeded', () => {
    expect(new AskTimeoutError(120_000).timeoutMs).toBe(120_000);
  });

  it('states the limit in the message', () => {
    expect(new AskTimeoutError(5_000).message).toBe('The question did not finish within 5000 ms');
  });

  it('keeps the wrapped error as its cause', () => {
    const cause = new Error('aborted');

    expect(new AskTimeoutError(5_000, { cause }).cause).toBe(cause);
  });
});
