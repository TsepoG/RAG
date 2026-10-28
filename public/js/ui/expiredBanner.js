// @ts-check
import { el } from '../dom.js';
import { EXPIRED_MESSAGE } from '../signIn.js';
import { icon } from './icons.js';
import { buildSignInLink } from './signIn.js';

/** The line under the banner's title. */
export const EXPIRED_TEXT = 'Sign in again to keep going. This conversation will still be here.';

/** What the link says. */
export const SIGN_IN_AGAIN_LABEL = 'Sign in again';

/**
 * Builds the banner shown in place of the question box when a question was refused because the
 * Atlassian sign-in has expired. Signing in again comes back to the page, which restores the
 * conversation as a reload would.
 * @returns {HTMLElement} The banner.
 */
export function buildExpiredBanner() {
  return el(
    'section',
    { className: 'expired-banner', attributes: { 'aria-labelledby': 'expired-title' } },
    [
      el('span', { className: 'expired-banner__icon' }, [icon('lock')]),
      el('div', { className: 'expired-banner__body' }, [
        el('h2', {
          className: 'expired-banner__title',
          text: EXPIRED_MESSAGE,
          attributes: { id: 'expired-title' },
        }),
        el('p', { className: 'expired-banner__text', text: EXPIRED_TEXT }),
      ]),
      buildSignInLink(SIGN_IN_AGAIN_LABEL),
    ],
  );
}
