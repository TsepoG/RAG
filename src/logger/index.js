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

// Credentials that can appear inside free text, such as an error message from a server: an
// Authorization value, or a token in one of the formats GitHub and Atlassian issue.
const CREDENTIAL_PATTERN =
  /\b(?:Bearer|Basic)\s+[\w.~+/=-]+|\b(?:gh[pousr]_|github_pat_|ATATT)[\w-]+/gi;
const TRUNCATION_MARKER = '…';

/**
 * Makes free text safe to log: masks the given secrets and anything shaped like a credential, then
 * shortens it. Masking comes first, so cutting the text can never leave part of a secret behind.
 * pino's redaction works on keys, so it cannot do this for a token inside a string.
 * @param {string} text - The text, such as an error message.
 * @param {ReadonlyArray<string>} secrets - Exact secret values to mask; empty ones are ignored.
 * @param {number} maxChars - Longest result, including the marker that shows it was cut.
 * @returns {string} The masked, possibly shortened text.
 */
export function maskSecrets(text, secrets, maxChars) {
  const longestFirst = secrets
    .filter((secret) => secret !== '')
    .sort((a, b) => b.length - a.length);
  const masked = longestFirst
    .reduce((result, secret) => result.replaceAll(secret, REDACTED_VALUE), text)
    .replace(CREDENTIAL_PATTERN, REDACTED_VALUE);
  return masked.length > maxChars
    ? `${masked.slice(0, maxChars - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
    : masked;
}

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
