// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** Where signing in starts. A real link: the server sends the browser on to Atlassian. */
export const SIGN_IN_PATH = '/auth/atlassian/start';

/** The heading of the sign-in screen. */
export const SIGN_IN_HEADING = 'Sign in to get started';

/** The line under it. */
export const SIGN_IN_TEXT =
  'Sign in with your Atlassian account. The assistant reads Confluence with your own access, read-only. Your sign-in stays on this computer.';

/** What the button says. */
export const SIGN_IN_LABEL = 'Sign in with Atlassian';

/**
 * Builds the link that starts a sign-in, styled as a button.
 * @param {string} text - What it says.
 * @returns {HTMLElement} The link.
 */
export function buildSignInLink(text) {
  return el('a', {
    className: 'button button--primary',
    text,
    attributes: { href: SIGN_IN_PATH },
  });
}

/**
 * Builds the screen shown instead of the welcome screen in oauth mode when nobody is signed in.
 * @returns {HTMLElement} The screen.
 */
export function buildSignIn() {
  return el(
    'section',
    { className: 'sign-in', attributes: { 'aria-labelledby': 'sign-in-heading' } },
    [
      el('span', { className: 'brand__mark' }, [icon('brand', { size: 18 })]),
      el('h2', {
        className: 'sign-in__heading',
        text: SIGN_IN_HEADING,
        attributes: { id: 'sign-in-heading' },
      }),
      el('p', { className: 'sign-in__text', text: SIGN_IN_TEXT }),
      buildSignInLink(SIGN_IN_LABEL),
    ],
  );
}
