// @ts-check
import { describe, expect, it } from 'vitest';
import { AtlassianSignInRequiredError } from '../../src/errors/index.js';
import { describeFailure } from '../../src/server/failure.js';

describe('describeFailure for a sign-in that ran out mid-question', () => {
  it('says the Atlassian sign-in has expired', () => {
    expect(describeFailure(new AtlassianSignInRequiredError())).toEqual({
      kind: 'signin',
      message: 'Your Atlassian sign-in has expired. Sign in again to keep going.',
    });
  });
});
