// @ts-check
import { z } from 'zod';
import { DEFAULT_LOG_LEVEL } from '../logger/index.js';

// Messages describe the rule, never the offending value, so a bad token can't leak into an error.

const NODE_ENVS = ['development', 'test', 'production'];
const DEFAULT_NODE_ENV = 'development';
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const DEFAULT_PORT = '3000';
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const LIST_SEPARATOR = ',';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const ATLASSIAN_SITE_PATTERN = /^https:\/\/[a-z\d-]+\.atlassian\.net\/?$/i;
const PORT_PATTERN = /^\d+$/;
const PORT_MESSAGE = `must be an integer between ${MIN_PORT} and ${MAX_PORT}`;

const requiredString = z
  .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be a string') })
  .trim()
  .min(1, 'must not be empty');

/**
 * Splits a comma-separated value into trimmed, non-empty entries.
 * @param {string} value - Raw environment value.
 * @returns {string[]} The entries in their original order.
 */
function splitList(value) {
  return value
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Builds the schema for a required comma-separated list.
 * @param {string} noun - What an entry is, used in messages (for example "repository").
 * @param {(entry: string) => boolean} isValidEntry - Whether a single entry is acceptable.
 * @param {string} entryRule - Describes a valid entry, used in the message for bad entries.
 * @returns {z.ZodType<string[], string>} Schema yielding the parsed entries.
 */
function requiredList(noun, isValidEntry, entryRule) {
  const entries = z
    .array(z.string())
    .min(1, `must list at least one ${noun}`)
    .refine((items) => items.every(isValidEntry), `every entry must ${entryRule}`);
  return requiredString.transform(splitList).pipe(entries);
}

/**
 * Whether a number is a usable TCP port.
 * @param {number} port - Candidate port.
 * @returns {boolean} True for integers within the TCP port range.
 */
function isValidPort(port) {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * Schema for the process environment. Parsing yields the nested, typed config object.
 */
export const configSchema = z
  .object({
    NODE_ENV: z
      .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` })
      .default(DEFAULT_NODE_ENV),
    LOG_LEVEL: z
      .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
      .default(DEFAULT_LOG_LEVEL),
    PORT: z
      .string()
      .regex(PORT_PATTERN, PORT_MESSAGE)
      .default(DEFAULT_PORT)
      .transform(Number)
      .refine(isValidPort, PORT_MESSAGE),
    GITHUB_TOKEN: requiredString,
    GITHUB_REPOS: requiredList(
      'repository',
      (entry) => REPO_PATTERN.test(entry),
      'look like owner/repo',
    ),
    // Piped so the format check only runs on a non-empty value, giving one message per problem.
    ATLASSIAN_SITE_URL: requiredString.pipe(
      z
        .string()
        .regex(ATLASSIAN_SITE_PATTERN, 'must look like https://<site>.atlassian.net')
        // origin drops any trailing slash and lower-cases the host.
        .transform((url) => new URL(url).origin),
    ),
    ATLASSIAN_EMAIL: requiredString.pipe(z.email('must be a valid email address')),
    ATLASSIAN_API_TOKEN: requiredString,
    CONFLUENCE_SPACE_KEYS: requiredList(
      'space key',
      (entry) => !/\s/.test(entry),
      'not contain spaces',
    ),
    COPILOT_MODEL: z.string().trim().min(1, 'must not be empty when set').optional(),
  })
  .transform((env) => ({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
    github: { token: env.GITHUB_TOKEN, repos: env.GITHUB_REPOS },
    atlassian: {
      siteUrl: env.ATLASSIAN_SITE_URL,
      email: env.ATLASSIAN_EMAIL,
      apiToken: env.ATLASSIAN_API_TOKEN,
      spaceKeys: env.CONFLUENCE_SPACE_KEYS,
    },
    copilot: { model: env.COPILOT_MODEL },
  }));
