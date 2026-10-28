// @ts-check
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../public/js/api.js';
import {
  createSignInState,
  isSignInError,
  isSignInEvent,
  SIGN_IN_REQUIRED,
} from '../../../public/js/signIn.js';

describe('isSignInError', () => {
  it('is true for the server saying a sign-in is needed', () => {
    expect(isSignInError(new ApiError('Sign in', 401, SIGN_IN_REQUIRED))).toBe(true);
  });

  it.each([
    ['another code', new ApiError('Gone', 404, 'conversation_ended')],
    ['no code', new ApiError('Down')],
    ['an error that is not from the server', new Error('x')],
  ])('is false for %s', (_label, error) => {
    expect(isSignInError(error)).toBe(false);
  });
});

describe('isSignInEvent', () => {
  it('is true for a streamed error of kind signin', () => {
    expect(isSignInEvent({ event: 'error', data: { kind: 'signin', message: 'x' } })).toBe(true);
  });

  it.each([
    ['another kind of error', { event: 'error', data: { kind: 'timeout' } }],
    ['another event', { event: 'done', data: { kind: 'signin' } }],
    ['an error without data', { event: 'error', data: null }],
    ['an error whose data is text', { event: 'error', data: 'signin' }],
  ])('is false for %s', (_label, event) => {
    expect(isSignInEvent(event)).toBe(false);
  });
});

describe('createSignInState', () => {
  it('needs no sign-in until the server says otherwise', () => {
    expect(createSignInState().view()).toEqual({ needed: false, account: undefined });
  });

  it.each(['basic', 'bearer'])('never asks to sign in in %s mode', (mode) => {
    const state = createSignInState();

    state.load({ mode, signedIn: true });

    expect(state.view()).toEqual({ needed: false, account: undefined });
  });

  it('asks to sign in in oauth mode when nobody is signed in', () => {
    const state = createSignInState();

    state.load({ mode: 'oauth', signedIn: false });

    expect(state.view()).toEqual({ needed: true, account: undefined });
  });

  it('names the site of a working sign-in', () => {
    const state = createSignInState();

    state.load({ mode: 'oauth', signedIn: true, siteHost: 'acme.atlassian.net' });

    expect(state.view()).toEqual({ needed: false, account: { siteHost: 'acme.atlassian.net' } });
  });

  it('hides the account once the server refuses a question for want of a sign-in', () => {
    const state = createSignInState();
    state.load({ mode: 'oauth', signedIn: true, siteHost: 'acme.atlassian.net' });

    state.markNeeded();

    expect(state.view()).toEqual({ needed: true, account: undefined });
  });

  it('asks to sign in after signing out', () => {
    const state = createSignInState();
    state.load({ mode: 'oauth', signedIn: true });

    state.signedOut();

    expect(state.view()).toEqual({ needed: true, account: undefined });
  });

  it('asks to sign in after signing out even before the status was known', () => {
    const state = createSignInState();

    state.signedOut();

    expect(state.view().needed).toBe(true);
  });
});
