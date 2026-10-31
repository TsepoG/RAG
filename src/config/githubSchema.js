// @ts-check
import { isAbsolute } from 'node:path';
import { z } from 'zod';

// The settings that choose how the app reads GitHub, and the rules only gh-cli mode has. Messages
// describe the rule, never the offending value.

/** The default: a fine-grained personal access token in GITHUB_TOKEN. */
export const TOKEN_MODE = 'token';

/** The mode in which the token comes from the person's own GitHub CLI login (`gh auth login`). */
export const GH_CLI_MODE = 'gh-cli';

const GITHUB_AUTH_MODES = /** @type {const} */ ([TOKEN_MODE, GH_CLI_MODE]);

/** The GitHub CLI, found through PATH, when GITHUB_CLI_PATH is not set. */
export const DEFAULT_GITHUB_CLI = 'gh';

/** The variables this module reads, so the runtime filter withholds them like every other one. */
export const GITHUB_ENV_NAMES = Object.freeze(['GITHUB_AUTH_MODE', 'GITHUB_CLI_PATH']);

// gh-cli mode has no token, but the shared schemas require one. A fixed stand-in lets them run
// unchanged, so token mode's rules, messages and output stay exactly what they were. It is
// replaced before the config is built and is never sent anywhere.
const STAND_IN_TOKEN = 'no-token-in-gh-cli-mode';

const githubSettingsSchema = z.object({
  GITHUB_AUTH_MODE: z
    .enum(GITHUB_AUTH_MODES, { error: `must be one of ${GITHUB_AUTH_MODES.join(', ')}` })
    .default(TOKEN_MODE),
  GITHUB_CLI_PATH: z
    .string()
    .trim()
    // Each check stops the ones after it, so a value gets one message: its first problem.
    .min(1, { error: 'must not be empty when set', abort: true })
    .refine(isAbsolute, { error: 'must be an absolute path to the gh program' })
    .optional(),
});

/**
 * How the app reads GitHub, as the settings say.
 * @typedef {object} GithubSettings
 * @property {'token' | 'gh-cli'} mode - The mode.
 * @property {string} cliPath - The gh program: GITHUB_CLI_PATH, or `gh` from PATH.
 */

/**
 * Reads the GitHub settings from the raw environment, before the shared schemas run, so the mode
 * can choose what they are given.
 * @param {unknown} input - The raw environment.
 * @returns {{ ok: true, settings: GithubSettings } | { ok: false, issues: Array<{ path: PropertyKey[], message: string }> }}
 *   The settings, or the problems with them.
 */
export function readGithubSettings(input) {
  const result = githubSettingsSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    };
  }
  return {
    ok: true,
    settings: {
      mode: result.data.GITHUB_AUTH_MODE,
      cliPath: result.data.GITHUB_CLI_PATH ?? DEFAULT_GITHUB_CLI,
    },
  };
}

/**
 * Whether a token is set in the raw environment: in gh-cli mode it is ignored, and the app says so.
 * @param {unknown} input - The raw environment.
 * @returns {boolean} True when GITHUB_TOKEN holds anything but spaces.
 */
function hasToken(input) {
  const token = /** @type {Record<string, unknown>} */ (input).GITHUB_TOKEN;
  return typeof token === 'string' && token.trim() !== '';
}

/**
 * What the shared schemas are given: the raw environment in token mode, and in gh-cli mode the
 * same with the stand-in token, so the token is not required. The mode is read from the raw value,
 * so a bad GITHUB_CLI_PATH in gh-cli mode is not also reported as a missing token.
 * @param {Record<string, unknown>} input - The raw environment.
 * @returns {Record<string, unknown>} The environment to parse.
 */
export function inputForMode(input) {
  return input.GITHUB_AUTH_MODE === GH_CLI_MODE
    ? { ...input, GITHUB_TOKEN: STAND_IN_TOKEN }
    : input;
}

/**
 * The GitHub settings of the config. Token mode is `{ token, repos }`, exactly as it always was.
 * gh-cli mode has no token: it comes from the CLI when needed, and is never part of the config.
 * @typedef {object} GithubConfig
 * @property {'gh-cli'} [mode] - Set only in gh-cli mode.
 * @property {string | undefined} token - The personal access token; set in token mode only.
 * @property {string[]} repos - The repositories that may be read.
 * @property {string} [cliPath] - gh-cli mode: the gh program to run.
 * @property {boolean} [tokenIgnored] - gh-cli mode: whether a GITHUB_TOKEN was set and ignored.
 */

/**
 * Builds the GitHub part of the config for the mode.
 * @param {{ token: string, repos: string[] }} parsed - What the shared schemas made of it.
 * @param {GithubSettings} settings - The GitHub settings.
 * @param {unknown} input - The raw environment, to see whether a token was set.
 * @returns {GithubConfig} The GitHub settings.
 */
export function githubConfig(parsed, settings, input) {
  if (settings.mode !== GH_CLI_MODE) {
    return parsed;
  }
  return {
    mode: GH_CLI_MODE,
    token: undefined,
    repos: parsed.repos,
    cliPath: settings.cliPath,
    tokenIgnored: hasToken(input),
  };
}
