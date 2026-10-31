// @ts-check
import { describe, expect, it } from 'vitest';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import { describeFailure } from '../../src/server/failure.js';

describe('describeFailure for a missing GitHub CLI token', () => {
  it.each(['logged-out', 'sso', 'cli-missing'])(
    'is a sign-in failure with the fixed message for %s',
    (reason) => {
      const error = new GithubSignInRequiredError(
        /** @type {import('../../src/errors/index.js').GithubSignInReason} */ (reason),
        { cause: new Error('gho_FAKEfakeFAKEfake0123456789abcdefXYZ') },
      );

      expect(describeFailure(error)).toEqual({ kind: 'signin', message: error.message });
      expect(describeFailure(error).message).not.toContain('gho_');
    },
  );
});
