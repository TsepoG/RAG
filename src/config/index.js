// @ts-check
import { ConfigError } from '../errors/index.js';
import { REDACTED_VALUE } from '../logger/index.js';
import { configSchema } from './schema.js';

/**
 * The validated application settings, grouped by system.
 * @typedef {import('zod').output<typeof configSchema>} AppConfig
 */

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
  return {
    ...config,
    github: { ...config.github, token: REDACTED_VALUE },
    atlassian: { ...config.atlassian, apiToken: REDACTED_VALUE },
  };
}
