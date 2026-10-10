// @ts-check
import { existsSync } from 'node:fs';
import { ConfigError } from '../errors/index.js';
import { REDACTED_VALUE } from '../logger/index.js';
import { configSchema, ENV_VARIABLE_NAMES } from './schema.js';

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
  return {
    ...config,
    github: { ...config.github, token: REDACTED_VALUE },
    atlassian: { ...config.atlassian, apiToken: REDACTED_VALUE },
    // An unset token stays unset, so the log doesn't suggest one is configured.
    copilot: {
      ...config.copilot,
      githubToken: githubToken === undefined ? undefined : REDACTED_VALUE,
    },
  };
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
