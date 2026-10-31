// @ts-check
import {
  GITHUB_CHECK_FAILED,
  GITHUB_MESSAGES,
  GITHUB_READY_MESSAGE,
  githubReasonOf,
} from './signIn.js';

/**
 * What the GitHub actions work with: the chat's own parts.
 * @typedef {object} GithubActionDeps
 * @property {{ fetchAuthStatus?: typeof import('./api.js').fetchAuthStatus, checkGithub?: typeof import('./api.js').checkGithub }} api -
 *   The server.
 * @property {Pick<ReturnType<typeof import('./signIn.js').createSignInState>, 'loadGithub' | 'markGithubNeeded' | 'view'>} signIn -
 *   The sign-in state.
 * @property {(text: string) => void} announce - Tells screen readers.
 * @property {(text: string) => void} notice - Shows a notice on the page.
 * @property {() => void} render - Draws the page.
 */

/**
 * Creates what the page does about the GitHub CLI's login in gh-cli mode: shows that it is needed,
 * and looks again when the person presses Check again after logging in in a terminal.
 * @param {GithubActionDeps} deps - The chat's parts.
 * @returns {{ need: (reason?: string) => void, check: () => Promise<void> }} The actions.
 */
export function createGithubActions({ api, signIn, announce, notice, render }) {
  /**
   * Reads GitHub's status, to learn why there is no token when the refusal did not say.
   * @returns {Promise<void>} Resolves once it is shown, or when it cannot be read.
   */
  async function refresh() {
    try {
      const status = await api.fetchAuthStatus?.();
      if (status?.github !== undefined) {
        signIn.loadGithub(status.github);
        render();
      }
    } catch {
      // The banner already says what to do; the reason only sharpens the wording.
    }
  }

  return {
    need(reason) {
      signIn.markGithubNeeded(reason);
      announce(GITHUB_MESSAGES[githubReasonOf(reason)]);
      render();
      if (reason === undefined) {
        void refresh();
      }
    },
    async check() {
      if (api.checkGithub === undefined) {
        return;
      }
      try {
        signIn.loadGithub((await api.checkGithub()).github);
      } catch {
        notice(GITHUB_CHECK_FAILED);
        return;
      }
      render();
      const github = signIn.view().github;
      announce(github?.needed ? GITHUB_MESSAGES[github.reason] : GITHUB_READY_MESSAGE);
    },
  };
}
