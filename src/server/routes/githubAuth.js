// @ts-check

/** The code a refused request carries when gh-cli mode has no GitHub CLI token to use. */
export const GITHUB_SIGN_IN_CODE = 'github_signin_required';

/**
 * The answer to a request that needs the GitHub CLI's token when there is none that works. The
 * message is the error's own, which is fixed for each reason and holds nothing from gh or GitHub.
 * @param {import('../../errors/index.js').GithubSignInRequiredError} error - Why there is no token.
 * @returns {{ code: string, reason: import('../../errors/index.js').GithubSignInReason, message: string }} The body.
 */
export function githubSignInRequired({ reason, message }) {
  return { code: GITHUB_SIGN_IN_CODE, reason, message };
}
