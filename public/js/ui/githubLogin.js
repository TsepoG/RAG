// @ts-check
import { el } from '../dom.js';
import { GITHUB_MESSAGES } from '../signIn.js';
import { icon } from './icons.js';

/** What the button that looks at the GitHub CLI again says. */
export const CHECK_AGAIN_LABEL = 'Check again';

/**
 * What to do for each reason the GitHub CLI has no token: the words before the command, the
 * command, and the words after it. The login happens in a terminal, so there is no link.
 * @type {Readonly<Record<keyof typeof GITHUB_MESSAGES, readonly [string, string, string]>>}
 */
export const GITHUB_STEPS = Object.freeze({
  'logged-out': ['Run ', 'gh auth login', ' in a terminal, then press Check again.'],
  sso: [
    'Run ',
    'gh auth refresh -h github.com',
    ' to authorise your organisation, then press Check again.',
  ],
  'cli-missing': [
    'Install the GitHub CLI, or set ',
    'GITHUB_CLI_PATH',
    ', then press Check again.',
  ],
});

/**
 * Says which GitHub account the app reads with, for the signed-in panel.
 * @param {string | undefined} login - The GitHub CLI's account, if gh could say.
 * @returns {string} For example "GitHub: TsepoG (GitHub CLI)".
 */
export function describeGithubAccount(login) {
  return login === undefined || login === ''
    ? 'GitHub (GitHub CLI)'
    : `GitHub: ${login} (GitHub CLI)`;
}

/**
 * Builds the line that says what to do, with the command set as code.
 * @param {keyof typeof GITHUB_MESSAGES} reason - Why there is no token.
 * @param {string} className - The paragraph's class.
 * @returns {HTMLElement} The paragraph.
 */
function buildSteps(reason, className) {
  const [before, command, after] = GITHUB_STEPS[reason];
  return el('p', { className }, [before, el('code', { text: command }), after]);
}

/**
 * Builds the Check again button.
 * @param {string} className - Its classes.
 * @returns {HTMLElement} The button.
 */
function buildCheckAgain(className) {
  return el('button', {
    className,
    text: CHECK_AGAIN_LABEL,
    attributes: { type: 'button', 'data-action': 'check-github' },
  });
}

/**
 * Builds the GitHub part of the sign-in screen, shown before the first question while the GitHub
 * CLI has no token. When it is the only thing to do, it carries the brand mark, as the Atlassian
 * sign-in screen does.
 * @param {keyof typeof GITHUB_MESSAGES} reason - Why there is no token.
 * @param {{ brand: boolean }} options - Whether to show the brand mark.
 * @returns {HTMLElement} The screen.
 */
export function buildGithubSignIn(reason, { brand }) {
  return el(
    'section',
    { className: 'sign-in', attributes: { 'aria-labelledby': 'github-sign-in-heading' } },
    [
      ...(brand ? [el('span', { className: 'brand__mark' }, [icon('brand', { size: 18 })])] : []),
      el('h2', {
        className: 'sign-in__heading',
        text: GITHUB_MESSAGES[reason],
        attributes: { id: 'github-sign-in-heading' },
      }),
      buildSteps(reason, 'sign-in__text'),
      buildCheckAgain('button button--primary'),
    ],
  );
}

/**
 * Builds the banner shown in place of the question box when a question was refused because the
 * GitHub CLI has no token. The conversation is kept; Check again brings the question box back.
 * @param {keyof typeof GITHUB_MESSAGES} reason - Why there is no token.
 * @returns {HTMLElement} The banner.
 */
export function buildGithubBanner(reason) {
  return el(
    'section',
    { className: 'expired-banner', attributes: { 'aria-labelledby': 'github-banner-title' } },
    [
      el('span', { className: 'expired-banner__icon' }, [icon('lock')]),
      el('div', { className: 'expired-banner__body' }, [
        el('h2', {
          className: 'expired-banner__title',
          text: GITHUB_MESSAGES[reason],
          attributes: { id: 'github-banner-title' },
        }),
        buildSteps(reason, 'expired-banner__text'),
      ]),
      buildCheckAgain('button button--primary'),
    ],
  );
}
