// @ts-check
import { buildExpiredBanner } from './expiredBanner.js';
import { buildGithubBanner, buildGithubSignIn } from './githubLogin.js';
import { buildSignIn } from './signIn.js';

/**
 * What needs the person's attention before they can ask more: the Atlassian sign-in, the GitHub
 * CLI's login, or both.
 * @typedef {object} Attention
 * @property {boolean} atlassian - Whether they must sign in to Atlassian.
 * @property {keyof typeof import('../signIn.js').GITHUB_MESSAGES | undefined} github - Why the GitHub
 *   CLI has no token, when it has none.
 */

/**
 * Reads what needs attention from the sign-in view.
 * @param {import('../signIn.js').SignInView} signIn - The sign-in view.
 * @returns {Attention} What needs attention.
 */
export function attentionOf(signIn) {
  return {
    atlassian: signIn.github === undefined ? signIn.needed : signIn.atlassianNeeded === true,
    github: signIn.github?.needed === true ? signIn.github.reason : undefined,
  };
}

/**
 * Who the signed-in panel names: the Atlassian sign-in, and in gh-cli mode the GitHub account while
 * the GitHub CLI has a token.
 * @param {import('../signIn.js').SignInView} signIn - The sign-in view.
 * @returns {import('./signedInPanel.js').PanelAccount | undefined} Who to name, or undefined for no panel.
 */
export function panelAccountOf({ account, github }) {
  const githubAccount = github === undefined || github.needed ? undefined : { login: github.login };
  if (githubAccount === undefined) {
    return account;
  }
  return { ...account, atlassian: account !== undefined, github: githubAccount };
}

/**
 * Builds the sign-in screen: one part for each thing to do, Atlassian first. The brand mark shows
 * once, at the top.
 * @param {Attention} attention - What needs attention.
 * @returns {HTMLElement[]} The parts.
 */
export function buildSignInScreens({ atlassian, github }) {
  return [
    ...(atlassian ? [buildSignIn()] : []),
    ...(github === undefined ? [] : [buildGithubSignIn(github, { brand: !atlassian })]),
  ];
}

/**
 * Builds the banners shown in place of the question box: one for each thing to do, Atlassian first.
 * @param {Attention} attention - What needs attention.
 * @returns {HTMLElement[]} The banners.
 */
export function buildAttentionBanners({ atlassian, github }) {
  return [
    ...(atlassian ? [buildExpiredBanner()] : []),
    ...(github === undefined ? [] : [buildGithubBanner(github)]),
  ];
}
