// @ts-check
import { z } from 'zod';
import { DEFAULT_LOG_LEVEL } from '../logger/index.js';

// Messages describe the rule, never the offending value, so a bad token can't leak into an error.

const NODE_ENVS = ['development', 'test', 'production'];
const DEFAULT_NODE_ENV = 'development';
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const PORT_LIMITS = { min: 1, max: 65_535, fallback: 3000 };
const ASK_TIMEOUT_LIMITS = { min: 5000, max: 600_000, fallback: 120_000 };
const MAX_TOOL_CALLS_LIMITS = { min: 1, max: 50, fallback: 12 };
const MCP_TIMEOUT_LIMITS = { min: 1000, max: 120_000, fallback: 30_000 };
const ATLASSIAN_AUTH_MODES = ['basic', 'bearer'];
const DEFAULT_ATLASSIAN_AUTH_MODE = 'basic';
const LIST_SEPARATOR = ',';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const ATLASSIAN_SITE_PATTERN = /^https:\/\/[a-z\d-]+\.atlassian\.net\/?$/i;
const INTEGER_PATTERN = /^\d+$/;
const DEFAULT_HOST = '127.0.0.1';
const HOST_PATTERN = /^[\w.:[\]-]+$/;
const LOOPBACK_NAMES = new Set(['localhost', '::1', '[::1]']);
const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;
const CLOUD_ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * Whether a host name or address is the machine itself: `localhost`, `::1` or any `127.x.x.x`.
 * The web server may listen only on these unless remote access is switched on.
 * @param {string} host - A host name or IP address.
 * @returns {boolean} True for a loopback host.
 */
export function isLoopbackHost(host) {
  const name = host.toLowerCase();
  return LOOPBACK_NAMES.has(name) || LOOPBACK_IPV4.test(name);
}

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
 * Builds the schema for an optional whole-number setting with a default.
 * @param {{ min: number, max: number, fallback: number }} limits - Inclusive range and default.
 * @returns {z.ZodType<number, string | undefined>} Schema yielding the number.
 */
function integerInRange({ min, max, fallback }) {
  const message = `must be an integer between ${min} and ${max}`;
  return z
    .string()
    .regex(INTEGER_PATTERN, message)
    .default(String(fallback))
    .transform(Number)
    .refine((value) => value >= min && value <= max, message);
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` })
    .default(DEFAULT_NODE_ENV),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .default(DEFAULT_LOG_LEVEL),
  PORT: integerInRange(PORT_LIMITS),
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
  ATLASSIAN_AUTH_MODE: z
    .enum(ATLASSIAN_AUTH_MODES, { error: `must be one of ${ATLASSIAN_AUTH_MODES.join(', ')}` })
    .default(DEFAULT_ATLASSIAN_AUTH_MODE),
  // Only basic auth (email:token) needs it; the check that it is present then is below.
  ATLASSIAN_EMAIL: requiredString.pipe(z.email('must be a valid email address')).optional(),
  // Optional: when set, every Confluence call uses it, so the model never has to look it up.
  ATLASSIAN_CLOUD_ID: requiredString
    .pipe(z.string().regex(CLOUD_ID_PATTERN, 'must look like a UUID'))
    .optional(),
  ATLASSIAN_API_TOKEN: requiredString,
  CONFLUENCE_SPACE_KEYS: requiredList(
    'space key',
    (entry) => !/\s/.test(entry),
    'not contain spaces',
  ),
  COPILOT_MODEL: z.string().trim().min(1, 'must not be empty when set').optional(),
  COPILOT_GITHUB_TOKEN: z.string().trim().min(1, 'must not be empty when set').optional(),
  ASK_TIMEOUT_MS: integerInRange(ASK_TIMEOUT_LIMITS),
  MAX_TOOL_CALLS: integerInRange(MAX_TOOL_CALLS_LIMITS),
  MCP_TIMEOUT_MS: integerInRange(MCP_TIMEOUT_LIMITS),
  HOST: z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .regex(HOST_PATTERN, 'must be a host name or IP address')
    .default(DEFAULT_HOST),
  // Anything but "true" keeps the server on this machine; see the rule below.
  ALLOW_REMOTE: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(['true', 'false'], { error: 'must be true or false' }))
    .default('false')
    .transform((value) => value === 'true'),
});

// Checked on the whole object so a missing email is reported together with any other problems.
const envSchemaWithAuthRule = envSchema.superRefine(
  (env, context) => {
    if (env.ATLASSIAN_AUTH_MODE === 'basic' && env.ATLASSIAN_EMAIL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['ATLASSIAN_EMAIL'],
        message: 'is required when ATLASSIAN_AUTH_MODE is basic',
      });
    }
  },
  {
    when: (payload) =>
      /** @type {Record<string, unknown>} */ (payload.value).ATLASSIAN_AUTH_MODE === 'basic',
  },
);

// The web server has no login, so it must not listen beyond this machine unless that is asked for
// by name. Checked on the whole object so the host and the switch are reported together.
const envSchemaWithHostRule = envSchemaWithAuthRule.superRefine((env, context) => {
  if (!isLoopbackHost(env.HOST) && !env.ALLOW_REMOTE) {
    context.addIssue({
      code: 'custom',
      path: ['HOST'],
      message:
        'must be a loopback address (127.0.0.1, localhost or ::1) unless ALLOW_REMOTE is true',
    });
  }
});

/**
 * Builds how to authenticate to Atlassian. A bearer key has no email, so the shape makes it
 * impossible to build a Basic header without one.
 * @param {{ ATLASSIAN_AUTH_MODE: string, ATLASSIAN_EMAIL?: string }} env - Parsed settings.
 * @returns {{ mode: 'basic', email: string } | { mode: 'bearer' }} The auth settings.
 */
function atlassianAuth({ ATLASSIAN_AUTH_MODE: mode, ATLASSIAN_EMAIL: email }) {
  // The refinement above guarantees an email in basic mode.
  return mode === 'bearer'
    ? { mode: 'bearer' }
    : { mode: 'basic', email: /** @type {string} */ (email) };
}

/**
 * Names of every environment variable the app reads, for code that must know what to strip.
 * @type {ReadonlyArray<string>}
 */
export const ENV_VARIABLE_NAMES = Object.freeze(Object.keys(envSchema.shape));

/**
 * Schema for the process environment. Parsing yields the nested, typed config object.
 */
export const configSchema = envSchemaWithHostRule.transform((env) => ({
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  port: env.PORT,
  server: { host: env.HOST, allowRemote: env.ALLOW_REMOTE },
  github: { token: env.GITHUB_TOKEN, repos: env.GITHUB_REPOS },
  atlassian: {
    siteUrl: env.ATLASSIAN_SITE_URL,
    cloudId: env.ATLASSIAN_CLOUD_ID,
    auth: atlassianAuth(env),
    apiToken: env.ATLASSIAN_API_TOKEN,
    spaceKeys: env.CONFLUENCE_SPACE_KEYS,
  },
  copilot: {
    model: env.COPILOT_MODEL,
    githubToken: env.COPILOT_GITHUB_TOKEN,
    askTimeoutMs: env.ASK_TIMEOUT_MS,
  },
  mcp: { maxToolCalls: env.MAX_TOOL_CALLS, timeoutMs: env.MCP_TIMEOUT_MS },
}));
