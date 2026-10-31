// @ts-check
import {
  AskTimeoutError,
  AtlassianSignInRequiredError,
  CopilotError,
  GithubSignInRequiredError,
  QuestionCancelledError,
} from '../errors/index.js';

/**
 * What the page is told when a question fails. The message is written for the person and holds
 * nothing from the error itself, which can name a path, a token or a tool's reply.
 * @typedef {object} Failure
 * @property {'timeout' | 'cancelled' | 'copilot' | 'signin' | 'github-signin' | 'internal'} kind - What
 *   sort of failure it was: `signin` for the Atlassian sign-in, `github-signin` for the GitHub CLI.
 * @property {string} message - What to show.
 */

/**
 * Turns the error a question ended with into what the page is told.
 * @param {unknown} error - What was thrown.
 * @returns {Failure} The kind and a message safe to show.
 */
export function describeFailure(error) {
  if (error instanceof AskTimeoutError) {
    return { kind: 'timeout', message: 'The question took too long to answer. Please try again.' };
  }
  if (error instanceof QuestionCancelledError) {
    return { kind: 'cancelled', message: 'The question was stopped.' };
  }
  if (error instanceof AtlassianSignInRequiredError) {
    return {
      kind: 'signin',
      message: 'Your Atlassian sign-in has expired. Sign in again to keep going.',
    };
  }
  if (error instanceof GithubSignInRequiredError) {
    // Fixed for each reason, and written for the person: nothing in it comes from gh or GitHub.
    return { kind: 'github-signin', message: error.message };
  }
  if (error instanceof CopilotError) {
    return { kind: 'copilot', message: 'Copilot could not answer just now. Please try again.' };
  }
  return { kind: 'internal', message: 'Something went wrong. Please try again.' };
}
