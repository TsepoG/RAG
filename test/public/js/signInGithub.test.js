// @ts-check
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../public/js/api.js';
import {
  createSignInState,
  GITHUB_SIGN_IN_REQUIRED,
  githubReasonOf,
  isGithubSignInError,
  isGithubSignInEvent,
} from '../../../public/js/signIn.js';

describe('isGithubSignInError', () => {
  it('is true only for a 401 github_signin_required', () => {
    expect(isGithubSignInError(new ApiError('x', 401, GITHUB_SIGN_IN_REQUIRED, 'sso'))).toBe(true);
    expect(isGithubSignInError(new ApiError('x', 401, 'atlassian_signin_required'))).toBe(false);
    expect(isGithubSignInError(new Error('x'))).toBe(false);
  });
});

describe('isGithubSignInEvent', () => {
  it('is true only for an error event of kind github-signin', () => {
    expect(isGithubSignInEvent({ event: 'error', data: { kind: 'github-signin' } })).toBe(true);
    expect(isGithubSignInEvent({ event: 'error', data: { kind: 'signin' } })).toBe(false);
    expect(isGithubSignInEvent({ event: 'done', data: { kind: 'github-signin' } })).toBe(false);
    expect(isGithubSignInEvent({ event: 'error', data: null })).toBe(false);
  });
});

describe('githubReasonOf', () => {
  it.each([
    ['sso', 'sso'],
    ['cli-missing', 'cli-missing'],
    ['logged-out', 'logged-out'],
    ['something-new', 'logged-out'],
    [undefined, 'logged-out'],
    ['toString', 'logged-out'],
  ])('reads %j as %s', (reason, expected) => {
    expect(githubReasonOf(reason)).toBe(expected);
  });
});

describe('the sign-in state with the GitHub CLI', () => {
  it('shows nothing about GitHub in token mode', () => {
    const state = createSignInState();

    state.load({ mode: 'basic', signedIn: true, github: { mode: 'token', signedIn: true } });

    expect(state.view()).toEqual({ needed: false, account: undefined });
  });

  it("names the GitHub CLI's account while it has a token", () => {
    const state = createSignInState();

    state.load({
      mode: 'basic',
      signedIn: true,
      github: { mode: 'gh-cli', signedIn: true, login: 'TsepoG' },
    });

    expect(state.view()).toEqual({
      needed: false,
      account: undefined,
      atlassianNeeded: false,
      github: { needed: false, reason: 'logged-out', login: 'TsepoG' },
    });
  });

  it('needs attention, with the reason, while the GitHub CLI has no token', () => {
    const state = createSignInState();

    state.load({
      mode: 'basic',
      signedIn: true,
      github: { mode: 'gh-cli', signedIn: false, reason: 'sso' },
    });

    expect(state.view()).toMatchObject({
      needed: true,
      atlassianNeeded: false,
      github: { needed: true, reason: 'sso' },
    });
  });

  it('keeps the Atlassian part apart, so both can need attention at once', () => {
    const state = createSignInState();

    state.load({
      mode: 'oauth',
      signedIn: false,
      github: { mode: 'gh-cli', signedIn: false, reason: 'logged-out' },
    });

    expect(state.view()).toMatchObject({
      needed: true,
      atlassianNeeded: true,
      github: { needed: true },
    });
  });

  it('marks the GitHub CLI as needed after a refusal, with a known reason or logged-out', () => {
    const state = createSignInState();

    state.markGithubNeeded('cli-missing');
    expect(state.view().github).toEqual({ needed: true, reason: 'cli-missing', login: undefined });

    state.markGithubNeeded();
    expect(state.view().github?.reason).toBe('logged-out');
  });

  it("takes in GitHub's status alone, after Check again", () => {
    const state = createSignInState();
    state.markGithubNeeded('logged-out');

    state.loadGithub({ mode: 'gh-cli', signedIn: true, login: 'TsepoG' });

    expect(state.view()).toMatchObject({
      needed: false,
      github: { needed: false, login: 'TsepoG' },
    });
  });

  it('forgets GitHub when the server says nothing about it', () => {
    const state = createSignInState();
    state.markGithubNeeded('logged-out');

    state.loadGithub(undefined);

    expect(state.view()).toEqual({ needed: false, account: undefined });
  });
});
