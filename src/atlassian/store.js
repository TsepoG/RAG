// @ts-check
import { randomBytes } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AtlassianAuthError } from '../errors/index.js';

/** The app's registration with Atlassian: no secret, kept across sign-ins and sign-outs. */
export const CLIENT_FILE = 'atlassian-client.json';

/** The sign-in itself: the tokens, and what the app checked about the account. */
export const SIGN_IN_FILE = 'atlassian-oauth.json';

/** Only the person who runs the app may open the folder (POSIX only). */
export const DIRECTORY_MODE = 0o700;
/** Only the person who runs the app may read or write the files (POSIX only). */
export const FILE_MODE = 0o600;

/** A temporary file must not exist yet: `wx` refuses to write over one. */
const CREATE_ONLY = 'wx';
const ENCODING = 'utf8';
const NOT_FOUND = 'ENOENT';
const TEMP_SUFFIX_BYTES = 6;
const JSON_INDENT = 2;

const clientSchema = z.object({
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
});

const signInSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  scopes: z.array(z.string()),
  cloudId: z.string().min(1),
  siteHost: z.string().min(1),
});

/**
 * The app's registration as a client of Atlassian's authorization server.
 * @typedef {z.output<typeof clientSchema>} StoredClient
 */

/**
 * A kept sign-in: the tokens, what was granted, and the site the account was checked against.
 * @typedef {z.output<typeof signInSchema>} StoredSignIn
 */

/**
 * The file-system calls the store makes, so a test can make one of them fail.
 * @typedef {Pick<typeof fsPromises, 'mkdir' | 'chmod' | 'writeFile' | 'rename' | 'readFile' | 'rm'>} StoreFs
 */

/**
 * Reads and writes the sign-in files in one folder.
 * @typedef {object} SignInStore
 * @property {() => Promise<StoredClient | undefined>} readClient - The registration, if there is a usable one.
 * @property {(client: StoredClient) => Promise<void>} writeClient - Saves the registration.
 * @property {() => Promise<StoredSignIn | undefined>} readSignIn - The sign-in, if there is a usable one.
 * @property {(signIn: StoredSignIn) => Promise<void>} writeSignIn - Saves the sign-in.
 * @property {() => Promise<void>} deleteSignIn - Removes the sign-in, keeping the registration.
 * @property {string} lockPath - The lock file that guards renewing the sign-in.
 */

/**
 * Whether an error is a file that does not exist.
 * @param {unknown} error - What was thrown.
 * @returns {boolean} True for ENOENT.
 */
function isNotFound(error) {
  return error instanceof Error && 'code' in error && error.code === NOT_FOUND;
}

/**
 * Creates the store for the sign-in folder.
 * - Files are written atomically: to a new temporary file first, then renamed over the old one, so
 *   a crash leaves either the old file or the new one, never half of one.
 * - The folder is made 0700 and the files 0600. Windows ignores these modes; there the files are
 *   protected only by the user profile they sit in.
 * - A file that is missing, unreadable or not in the expected shape counts as absent: a broken
 *   sign-in means signed out, never a crash. Only the reason is logged, never the content.
 * @param {object} deps - Where the files go, and how.
 * @param {string} deps.dir - The sign-in folder.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} deps.logger - Where problems are logged.
 * @param {StoreFs} [deps.fs] - The file-system calls; node:fs/promises by default.
 * @param {() => string} [deps.tempSuffix] - Makes a temporary file's name unique.
 * @returns {SignInStore} The store.
 */
export function createSignInStore({
  dir,
  logger,
  fs = fsPromises,
  tempSuffix = () => randomBytes(TEMP_SUFFIX_BYTES).toString('hex'),
}) {
  /**
   * Reads one file and checks its shape.
   * @template T
   * @param {string} name - The file name.
   * @param {z.ZodType<T>} schema - Its shape.
   * @returns {Promise<T | undefined>} The content, or undefined when there is no usable file.
   */
  async function read(name, schema) {
    let text;
    try {
      text = await fs.readFile(join(dir, name), ENCODING);
    } catch (error) {
      if (!isNotFound(error)) {
        logger.warn(
          { file: name, code: /** @type {{ code?: unknown }} */ (error).code },
          'could not read a sign-in file',
        );
      }
      return undefined;
    }
    const result = safeJson(text);
    const parsed = result.ok ? schema.safeParse(result.value) : undefined;
    if (parsed === undefined || !parsed.success) {
      logger.warn({ file: name }, 'a sign-in file is damaged; treating it as absent');
      return undefined;
    }
    return parsed.data;
  }

  /**
   * Writes one file atomically, with the folder and file locked down.
   * @param {string} name - The file name.
   * @param {unknown} value - What to write, as JSON.
   * @returns {Promise<void>}
   */
  async function write(name, value) {
    const target = join(dir, name);
    const temp = `${target}.${tempSuffix()}.tmp`;
    try {
      await fs.mkdir(dir, { recursive: true, mode: DIRECTORY_MODE });
      // mkdir leaves an existing folder as it was, so its mode is set again.
      await fs.chmod(dir, DIRECTORY_MODE);
      await fs.writeFile(temp, JSON.stringify(value, null, JSON_INDENT), {
        encoding: ENCODING,
        mode: FILE_MODE,
        flag: CREATE_ONLY,
      });
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw new AtlassianAuthError('failed', 'The Atlassian sign-in could not be saved', {
        cause: error,
      });
    }
  }

  return {
    readClient: () => read(CLIENT_FILE, clientSchema),
    writeClient: (client) => write(CLIENT_FILE, client),
    readSignIn: () => read(SIGN_IN_FILE, signInSchema),
    writeSignIn: (signIn) => write(SIGN_IN_FILE, signIn),
    async deleteSignIn() {
      await fs.rm(join(dir, SIGN_IN_FILE), { force: true });
    },
    lockPath: join(dir, 'atlassian-oauth.lock'),
  };
}

/**
 * Parses JSON without throwing.
 * @param {string} text - The text.
 * @returns {{ ok: true, value: unknown } | { ok: false }} The value, or a failure.
 */
function safeJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
