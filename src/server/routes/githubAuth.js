// @ts-check
import { GithubSignInRequiredError } from '../../errors/index.js';

/** The code a refused request carries when gh-cli mode has no GitHub CLI token to use. */
export const GITHUB_SIGN_IN_CODE = 'github_signin_required';

/** Where the page asks the server to look at the GitHub CLI again ("Check again"). */
export const GITHUB_CHECK_PATH = '/api/auth/github/check';

/** A request with an empty JSON object as its body, and nothing else. */
const EMPTY_BODY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {},
});

/**
 * The answer to a request that needs the GitHub CLI's token when there is none that works. The
 * message is the error's own, which is fixed for each reason and holds nothing from gh or GitHub.
 * @param {import('../../errors/index.js').GithubSignInRequiredError} error - Why there is no token.
 * @returns {{ code: string, reason: import('../../errors/index.js').GithubSignInReason, message: string }} The body.
 */
export function githubSignInRequired({ reason, message }) {
  return { code: GITHUB_SIGN_IN_CODE, reason, message };
}

/**
 * What the page is told about GitHub. It never holds a token.
 * @typedef {{ mode: 'token', signedIn: true } | { mode: 'gh-cli', signedIn: true, login?: string } | { mode: 'gh-cli', signedIn: false, reason: import('../../errors/index.js').GithubSignInReason }} GithubStatus
 */

/**
 * The GitHub side of signing in, as the web layer needs it.
 * @typedef {object} GithubAuth
 * @property {'token' | 'gh-cli'} mode - The GitHub auth mode.
 * @property {() => Promise<GithubStatus>} status - Whether the GitHub CLI has a token, and whose.
 * @property {() => Promise<GithubStatus>} check - The same after forgetting the cached token, so a
 *   login made in a terminal since is seen.
 * @property {() => Promise<ReturnType<typeof githubSignInRequired> | undefined>} refusal - The 401
 *   body when a question cannot be asked for want of a token, or undefined when it can.
 */

/**
 * Creates the GitHub side of signing in. Token mode always has its token; gh-cli mode asks the CLI.
 * @param {object} deps - What it works with.
 * @param {Pick<import('../../github/index.js').CliTokenProvider, 'getGithubToken' | 'invalidate' | 'getLogin'>} [deps.tokens] -
 *   The GitHub CLI's token provider, in gh-cli mode only.
 * @returns {GithubAuth} The GitHub side.
 */
export function createGithubAuth({ tokens } = {}) {
  if (tokens === undefined) {
    /** @type {GithubStatus} */
    const always = { mode: 'token', signedIn: true };
    return {
      mode: 'token',
      status: async () => always,
      check: async () => always,
      refusal: async () => undefined,
    };
  }
  const provider = tokens;

  /**
   * Turns a missing token into its reason, and passes anything else on.
   * @param {unknown} error - What was thrown.
   * @returns {import('../../errors/index.js').GithubSignInReason} The reason.
   */
  function reasonOf(error) {
    if (error instanceof GithubSignInRequiredError) {
      return error.reason;
    }
    throw error;
  }

  /** @returns {Promise<GithubStatus>} The status. */
  async function status() {
    try {
      await provider.getGithubToken();
    } catch (error) {
      return { mode: 'gh-cli', signedIn: false, reason: reasonOf(error) };
    }
    const login = await provider.getLogin();
    return login === undefined
      ? { mode: 'gh-cli', signedIn: true }
      : { mode: 'gh-cli', signedIn: true, login };
  }

  return {
    mode: 'gh-cli',
    status,
    async check() {
      provider.invalidate();
      return status();
    },
    async refusal() {
      try {
        await provider.getGithubToken();
        return undefined;
      } catch (error) {
        reasonOf(error);
        return githubSignInRequired(/** @type {GithubSignInRequiredError} */ (error));
      }
    },
  };
}

/**
 * Registers `POST /api/auth/github/check`, in gh-cli mode only: it forgets the cached token, asks the
 * GitHub CLI again, and answers with what the status route would say. It is under `/api`, so the
 * usual guards apply.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {{ githubAuth: GithubAuth, atlassianStatus: () => Promise<Record<string, unknown>> }} deps -
 *   The GitHub side, and the rest of the status as the status route gives it.
 */
export function registerGithubCheckRoute(app, { githubAuth, atlassianStatus }) {
  app.post(GITHUB_CHECK_PATH, { schema: { body: EMPTY_BODY_SCHEMA } }, async () => {
    return { ...(await atlassianStatus()), github: await githubAuth.check() };
  });
}
