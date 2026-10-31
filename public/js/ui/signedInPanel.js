// @ts-check
import { el } from '../dom.js';
import { describeGithubAccount } from './githubLogin.js';

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
 * Who the panel names.
 * @typedef {object} PanelAccount
 * @property {string | undefined} [siteHost] - The Atlassian site of the sign-in, in oauth mode.
 * @property {boolean} [atlassian] - Whether there is an Atlassian sign-in to show and sign out of;
 *   true unless said otherwise. False in gh-cli mode with a service account for Atlassian.
 * @property {{ login: string | undefined }} [github] - The GitHub CLI's account, in gh-cli mode.
 */

/**
 * Builds the panel at the bottom of the sidebar (and so of the drawer) that says who is signed in,
 * with a button to sign out of Atlassian. Signing out asks for no confirmation. In gh-cli mode it
 * also names the GitHub account; there is nothing to sign out of there, because the GitHub CLI's
 * login belongs to the terminal.
 * @param {PanelAccount} account - Who is signed in.
 * @returns {HTMLElement} The panel.
 */
export function buildSignedInPanel({ siteHost, atlassian = true, github }) {
  return el('div', { className: 'signed-in' }, [
    ...(atlassian
      ? [el('p', { className: 'signed-in__text', text: describeAccount(siteHost) })]
      : []),
    ...(github === undefined
      ? []
      : [el('p', { className: 'signed-in__text', text: describeGithubAccount(github.login) })]),
    ...(atlassian
      ? [
          el('button', {
            className: 'button',
            text: SIGN_OUT_LABEL,
            attributes: { type: 'button', 'data-action': 'sign-out' },
          }),
        ]
      : []),
  ]);
}
