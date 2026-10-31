// @ts-check
import { existsSync } from 'node:fs';
import { ConfigError } from '../errors/index.js';
import { REDACTED_VALUE } from '../logger/index.js';
import { configSchema, ENV_VARIABLE_NAMES } from './schema.js';

export { DEFAULT_GITHUB_CLI, GH_CLI_MODE, TOKEN_MODE } from './githubSchema.js';
export { isLoopbackHost } from './schema.js';

/** Said at startup when gh-cli mode finds a GITHUB_TOKEN it will not use. */
export const IGNORED_GITHUB_TOKEN_WARNING =
  'GITHUB_TOKEN is set but not used: GITHUB_AUTH_MODE is gh-cli, so GitHub is read with the GitHub CLI login';

/**
 * The validated application settings, grouped by system.
 * @typedef {import('zod').output<typeof configSchema>} AppConfig
 */

const ENV_FILE = '.env';

// Settings that mean nothing to a child process and carry no credentials.
const RUNTIME_SAFE_VARIABLES = new Set(['NODE_ENV', 'LOG_LEVEL', 'PORT']);

// Other names the Copilot runtime accepts as a GitHub credential (it checks COPILOT_GITHUB_TOKEN,
// then GH_TOKEN, then GITHUB_TOKEN), so they must not leak into it by accident.
const EXTRA_CREDENTIAL_VARIABLES = ['GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];

// Upper-cased because Windows environment names are case-insensitive. Built from the schema, so a
// variable added later is withheld from the runtime unless it is deliberately listed as safe.
const WITHHELD_FROM_RUNTIME = new Set([
  ...ENV_VARIABLE_NAMES.filter((name) => !RUNTIME_SAFE_VARIABLES.has(name)),
  ...EXTRA_CREDENTIAL_VARIABLES,
]);

/**
 * Freezes an object and everything reachable from it.
 * @template T
 * @param {T} value - Value to freeze.
 * @returns {T} The same value, now immutable.
 */
function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validates environment variables and returns the typed, frozen config.
 * @param {Record<string, string | undefined>} [env] - Variables to read; defaults to process.env.
 * @returns {AppConfig} The validated config.
 * @throws {ConfigError} Listing every missing or invalid variable by name, never by value.
 */
export function loadConfig(env = process.env) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ConfigError(issues, { cause: result.error });
  }
  return deepFreeze(result.data);
}

/**
 * Returns a copy of the config that is safe to log, with every secret masked.
 * @param {AppConfig} config - Config to copy; left unchanged.
 * @returns {AppConfig} A new object with the same shape and the tokens replaced.
 */
export function redactConfig(config) {
  const { githubToken } = config.copilot;
  const { apiToken } = config.atlassian;
  return {
    ...config,
    // gh-cli mode has no token in the config, so none is suggested.
    github: {
      ...config.github,
      token: config.github.token === undefined ? undefined : REDACTED_VALUE,
    },
    // An unset token (oauth mode has none) stays unset, so the log doesn't suggest one is configured.
    atlassian: {
      ...config.atlassian,
      apiToken: apiToken === undefined ? undefined : REDACTED_VALUE,
    },
    // An unset token stays unset, so the log doesn't suggest one is configured.
    copilot: {
      ...config.copilot,
      githubToken: githubToken === undefined ? undefined : REDACTED_VALUE,
    },
  };
}

/**
 * The warnings about the settings that are worth logging once at startup: they are valid, but
 * probably not what was meant.
 * @param {AppConfig} config - Validated config.
 * @returns {string[]} One line for each warning; none when all is as expected.
 */
export function configWarnings(config) {
  return config.github.tokenIgnored === true ? [IGNORED_GITHUB_TOKEN_WARNING] : [];
}

/**
 * Encodes an email and API token the way HTTP Basic auth expects. One function builds both the
 * header and the value that is masked in logs, so the two cannot drift apart.
 * @param {string} email - Account email.
 * @param {string} apiToken - Atlassian API token.
 * @returns {string} `base64(email:apiToken)`.
 */
export function encodeBasicCredentials(email, apiToken) {
  return Buffer.from(`${email}:${apiToken}`).toString('base64');
}

/**
 * Lists every secret value in the config, so error text can have them masked. It includes the
 * encoded Basic credential, which can show up in a message without its "Basic " prefix. A sign-in
 * made in oauth mode is not part of the config, so its tokens are not listed here.
 * @param {AppConfig} config - Validated config.
 * @returns {string[]} The secrets; unset ones are left out.
 */
export function listSecrets(config) {
  return [
    ...(config.github.token === undefined ? [] : [config.github.token]),
    ...atlassianSecrets(config.atlassian),
    ...(config.copilot.githubToken === undefined ? [] : [config.copilot.githubToken]),
  ];
}

/**
 * Lists the Atlassian secrets in the config: the API token and, in basic mode, its encoded form.
 * @param {AppConfig['atlassian']} atlassian - The Atlassian settings.
 * @returns {string[]} The secrets; none in oauth mode.
 */
function atlassianSecrets({ apiToken, auth }) {
  if (apiToken === undefined) {
    return [];
  }
  return auth.mode === 'basic'
    ? [apiToken, encodeBasicCredentials(auth.email, apiToken)]
    : [apiToken];
}

/**
 * Builds the environment handed to the Copilot runtime process.
 * Without this the runtime inherits everything, including the MCP token in GITHUB_TOKEN, and
 * would use it as the Copilot credential. Credentials reach it only through explicit options.
 * @param {Record<string, string | undefined>} [env] - Variables to filter; defaults to process.env.
 * @returns {Record<string, string>} A new object without this app's settings or any GitHub token.
 */
export function buildRuntimeEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const runtimeEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !WITHHELD_FROM_RUNTIME.has(name.toUpperCase())) {
      runtimeEnv[name] = value;
    }
  }
  return runtimeEnv;
}

/**
 * Variables that make `gh auth token` print themselves instead of the gh login. The app's own
 * GITHUB_TOKEN from .env has one of these names, so without this gh-cli mode could quietly use the
 * personal access token, or another account.
 */
const GH_LOGIN_OVERRIDES = new Set(['GH_TOKEN', 'GITHUB_TOKEN']);

/**
 * Builds the environment the GitHub CLI runs in, in gh-cli mode: this process's own, without the
 * variables that would replace the gh login. Names are compared in upper case, because Windows
 * treats them so.
 * @param {Record<string, string | undefined>} [env] - Variables to filter; defaults to process.env.
 * @returns {Record<string, string>} A new object; the input is left unchanged.
 */
export function buildGithubCliEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const cliEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !GH_LOGIN_OVERRIDES.has(name.toUpperCase())) {
      cliEnv[name] = value;
    }
  }
  return cliEnv;
}

/**
 * Options for {@link loadEnvFileIfPresent}; each default can be replaced in tests.
 * @typedef {object} EnvFileOptions
 * @property {string} [path] - File to load.
 * @property {(path: string) => boolean} [exists] - Whether the file exists.
 * @property {(path: string) => void} [load] - Copies the file's variables into the environment.
 */

/**
 * Loads a local .env file into the process environment, if there is one.
 * Variables already set in the shell win over the file.
 * @param {EnvFileOptions} [options] - File location and the functions that touch the disk.
 * @returns {boolean} True when a file was loaded.
 */
export function loadEnvFileIfPresent({
  path = ENV_FILE,
  exists = existsSync,
  load = process.loadEnvFile.bind(process),
} = {}) {
  if (!exists(path)) {
    return false;
  }
  load(path);
  return true;
}
