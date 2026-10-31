// @ts-check
import { describe, expect, it } from 'vitest';
import { AppError, GithubSignInRequiredError } from '../../src/errors/index.js';

describe('GithubSignInRequiredError', () => {
  it.each([
    ['logged-out', "GitHub CLI isn't logged in. Run `gh auth login` in a terminal."],
    ['sso', 'Run `gh auth refresh -h github.com` to authorise your organisation.'],
    ['cli-missing', 'GitHub CLI not found — install it or set GITHUB_CLI_PATH.'],
  ])('is an app error that records the reason %s with a fixed message', (reason, message) => {
    const error = new GithubSignInRequiredError(
      /** @type {import('../../src/errors/index.js').GithubSignInReason} */ (reason),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('GithubSignInRequiredError');
    expect(error.reason).toBe(reason);
    expect(error.message).toBe(message);
  });

  it('keeps the error it wraps', () => {
    const cause = new Error('spawn gh ENOENT');

    expect(new GithubSignInRequiredError('cli-missing', { cause }).cause).toBe(cause);
  });
});
