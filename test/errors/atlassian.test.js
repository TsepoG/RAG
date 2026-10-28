// @ts-check
import { describe, expect, it } from 'vitest';
import {
  AppError,
  AtlassianAuthError,
  AtlassianSignInRequiredError,
} from '../../src/errors/index.js';

describe('AtlassianSignInRequiredError', () => {
  it('is an app error that asks the person to sign in', () => {
    const cause = new Error('invalid_grant');
    const error = new AtlassianSignInRequiredError({ cause });

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AtlassianSignInRequiredError');
    expect(error.message).toBe('Sign in with Atlassian to keep going.');
    expect(error.cause).toBe(cause);
  });
});

describe('AtlassianAuthError', () => {
  it('is an app error that records why the sign-in did not complete', () => {
    const cause = new Error('network');
    const error = new AtlassianAuthError('wrong-site', 'This account cannot reach the site', {
      cause,
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AtlassianAuthError');
    expect(error.reason).toBe('wrong-site');
    expect(error.message).toBe('This account cannot reach the site');
    expect(error.cause).toBe(cause);
  });
});
