// @ts-check
import { el } from '../dom.js';

/** What the Sign out button says. */
export const SIGN_OUT_LABEL = 'Sign out';

/**
 * Says who is signed in. Atlassian gives no display name to an app like this, so the panel names
 * the site the sign-in reaches.
 * @param {string | undefined} siteHost - The site, if known.
 * @returns {string} For example "Signed in to acme.atlassian.net", or "Signed in".
 */
export function describeAccount(siteHost) {
  return siteHost === undefined || siteHost === '' ? 'Signed in' : `Signed in to ${siteHost}`;
}

/**
 * Builds the panel at the bottom of the sidebar (and so of the drawer) that says who is signed in,
 * with a button to sign out. Signing out asks for no confirmation.
 * @param {{ siteHost: string | undefined }} account - Who is signed in.
 * @returns {HTMLElement} The panel.
 */
export function buildSignedInPanel({ siteHost }) {
  return el('div', { className: 'signed-in' }, [
    el('p', { className: 'signed-in__text', text: describeAccount(siteHost) }),
    el('button', {
      className: 'button',
      text: SIGN_OUT_LABEL,
      attributes: { type: 'button', 'data-action': 'sign-out' },
    }),
  ]);
}
