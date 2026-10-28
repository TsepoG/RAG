// @ts-check
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// The settings only oauth mode reads, and the rules only it has. Messages describe the rule, never
// the offending value.

/** The auth mode in which the person signs in with their own Atlassian account. */
export const OAUTH_MODE = 'oauth';

/**
 * The only address the app may listen on in oauth mode: Atlassian sends the browser back to
 * http://127.0.0.1:<PORT>, so a server listening anywhere else would never see the sign-in.
 */
export const OAUTH_HOST = '127.0.0.1';

/** The folder in the home directory the sign-in is kept in when ATLASSIAN_OAUTH_DIR is not set. */
const DEFAULT_DIRECTORY_NAME = '.role-aware-assistant';

/** The repository; the sign-in must never be kept inside it, so it can never be committed. */
const PROJECT_DIRECTORY = fileURLToPath(new URL('../..', import.meta.url));

const PARENT_SEGMENT = '..';

/**
 * Whether a folder is the given parent folder or somewhere below it.
 * @param {string} directory - An absolute path.
 * @param {string} parent - An absolute path.
 * @returns {boolean} True when `directory` is `parent` or inside it.
 */
export function isInside(directory, parent) {
  const path = relative(parent, directory);
  // On Windows a folder on another drive comes back as an absolute path.
  return !(
    isAbsolute(path) ||
    path === PARENT_SEGMENT ||
    path.startsWith(`${PARENT_SEGMENT}${sep}`)
  );
}

/**
 * The folder the sign-in is kept in when none is configured.
 * @param {string} [home] - The home directory; defaults to the current user's.
 * @returns {string} `<home>/.role-aware-assistant`.
 */
export function defaultOauthDirectory(home = homedir()) {
  return join(home, DEFAULT_DIRECTORY_NAME);
}

/**
 * Builds how to authenticate in oauth mode: where the sign-in is kept.
 * @param {{ ATLASSIAN_OAUTH_DIR?: string }} env - Parsed settings.
 * @returns {{ mode: 'oauth', dir: string }} The auth settings.
 */
export function oauthAuth({ ATLASSIAN_OAUTH_DIR: dir }) {
  return { mode: OAUTH_MODE, dir: dir ?? defaultOauthDirectory() };
}

/** Schema for ATLASSIAN_OAUTH_DIR: optional, absolute, and outside the repository. */
export const oauthDirectorySchema = z
  .string()
  .trim()
  // Each check stops the ones after it, so a value gets one message: its first problem.
  .min(1, { error: 'must not be empty when set', abort: true })
  .refine(isAbsolute, { error: 'must be an absolute path', abort: true })
  .refine((directory) => !isInside(resolve(directory), PROJECT_DIRECTORY), {
    error: 'must be outside the project folder, so the sign-in can never be committed',
  })
  .optional();

/**
 * Whether a raw environment asks for oauth mode. Read before parsing, to pick the schema.
 * @param {unknown} input - The raw environment.
 * @returns {boolean} True when ATLASSIAN_AUTH_MODE is exactly `oauth`.
 */
export function isOauthMode(input) {
  return (
    typeof input === 'object' &&
    input !== null &&
    /** @type {Record<string, unknown>} */ (input).ATLASSIAN_AUTH_MODE === OAUTH_MODE
  );
}

/**
 * Reports a missing cloud id. In oauth mode the app checks the signed-in account against it and
 * re-checks pages over MCP with it, so it cannot be looked up later.
 * @param {{ ATLASSIAN_CLOUD_ID?: unknown }} env - The settings, possibly not yet valid.
 * @param {import('zod').RefinementCtx} context - Where issues are reported.
 */
export function requireCloudId(env, context) {
  if (env.ATLASSIAN_CLOUD_ID === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['ATLASSIAN_CLOUD_ID'],
      message: 'is required when ATLASSIAN_AUTH_MODE is oauth',
    });
  }
}

/**
 * Reports a host the sign-in cannot come back to.
 * @param {{ HOST: string }} env - The parsed settings.
 * @param {import('zod').RefinementCtx} context - Where issues are reported.
 */
export function requireOauthHost(env, context) {
  if (env.HOST !== OAUTH_HOST) {
    context.addIssue({
      code: 'custom',
      path: ['HOST'],
      message: `must be ${OAUTH_HOST} when ATLASSIAN_AUTH_MODE is oauth, because Atlassian sends the sign-in back to http://${OAUTH_HOST}:<PORT>`,
    });
  }
}
