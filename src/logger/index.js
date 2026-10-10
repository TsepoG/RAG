// @ts-check
import { pino } from 'pino';

/**
 * The structured logger used across the app.
 * @typedef {import('pino').Logger} Logger
 */

/**
 * Options for {@link createLogger}.
 * @typedef {object} LoggerOptions
 * @property {import('pino').LevelWithSilentOrString} [level] - Minimum level to emit.
 * @property {string} [name] - Component name added to every line.
 * @property {import('pino').DestinationStream} [destination] - Where lines go; stdout if omitted.
 */

/** Level used when the caller does not choose one. */
export const DEFAULT_LOG_LEVEL = 'info';

/** What a censored value is replaced with. */
export const REDACTED_VALUE = '***';

// Both spellings of authorization: pino paths are case-sensitive and HTTP header objects usually
// use "Authorization".
const SECRET_KEYS = [
  'token',
  'apiToken',
  'githubToken',
  'authorization',
  'Authorization',
  'password',
];
// pino has no recursive wildcard, so cover each key at the top level and up to four levels down.
// That reaches sessionConfig.mcpServers.<server>.headers.Authorization, the deepest shape we log.
const WILDCARD_PREFIXES = ['', '*.', '*.*.', '*.*.*.', '*.*.*.*.'];

/**
 * Every path pino must censor: each secret key at the top level and nested up to four levels deep.
 * @type {ReadonlyArray<string>}
 */
export const REDACT_PATHS = Object.freeze(
  SECRET_KEYS.flatMap((key) => WILDCARD_PREFIXES.map((prefix) => `${prefix}${key}`)),
);

/**
 * Creates a JSON logger that censors secret-looking keys.
 * @param {LoggerOptions} [options] - Level, component name and an optional output stream.
 * @returns {Logger} A pino logger writing one JSON object per line.
 */
export function createLogger({ level = DEFAULT_LOG_LEVEL, name, destination } = {}) {
  return pino(
    {
      level,
      name,
      redact: { paths: [...REDACT_PATHS], censor: REDACTED_VALUE },
      // Label instead of pino's numeric level so log lines are readable without a lookup table.
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
