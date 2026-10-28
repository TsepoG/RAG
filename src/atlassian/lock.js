// @ts-check
import * as fsPromises from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { AtlassianAuthError } from '../errors/index.js';

/**
 * A lock older than this is taken to belong to a process that died while holding it, and is
 * broken. Renewing a sign-in is one request with a shorter time limit than this.
 */
export const STALE_LOCK_MS = 30_000;

/** How long to wait for another process to finish before giving up. */
export const LOCK_WAIT_MS = 15_000;

/** How often to look again while another process holds the lock. */
export const LOCK_RETRY_MS = 50;

/** `wx` creates the file only if it does not exist: the one atomic test-and-set a file system has. */
const CREATE_ONLY = 'wx';
const ALREADY_EXISTS = 'EEXIST';
const NOT_FOUND = 'ENOENT';

/**
 * The file-system calls the lock makes.
 * @typedef {Pick<typeof fsPromises, 'open' | 'stat' | 'rm'>} LockFs
 */

/**
 * What the lock depends on, all replaceable in tests.
 * @typedef {object} LockOptions
 * @property {{ now: () => number }} clock - Time, in ms, compared with the lock file's age.
 * @property {LockFs} [fs] - The file-system calls; node:fs/promises by default.
 * @property {(ms: number) => Promise<unknown>} [sleep] - Waits between attempts.
 * @property {number} [staleMs] - When a held lock counts as abandoned.
 * @property {number} [waitMs] - How long to wait for the lock in all.
 * @property {number} [retryMs] - How long to wait between attempts.
 */

/**
 * Reads the error code of a file-system error.
 * @param {unknown} error - What was thrown.
 * @returns {unknown} Its code, if it has one.
 */
function codeOf(error) {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

/**
 * Runs a function while holding a lock file, so two processes (the server, `npm run ask`, the
 * eval) never renew the sign-in at the same moment and invalidate each other's refresh token.
 * The lock is a file created with `wx`; it is removed afterwards, even when the function fails. A
 * lock left behind by a process that died is broken once it is older than `staleMs`.
 * @template T
 * @param {string} path - The lock file.
 * @param {() => Promise<T>} run - What to do while holding it.
 * @param {LockOptions} options - Clock, file system and timings.
 * @returns {Promise<T>} What `run` returned.
 * @throws {AtlassianAuthError} When the lock stays held for longer than `waitMs`.
 */
export async function withLock(
  path,
  run,
  {
    clock,
    fs = fsPromises,
    sleep = delay,
    staleMs = STALE_LOCK_MS,
    waitMs = LOCK_WAIT_MS,
    retryMs = LOCK_RETRY_MS,
  },
) {
  const giveUpAt = clock.now() + waitMs;
  while (!(await tryAcquire(path, { clock, fs, staleMs }))) {
    if (clock.now() >= giveUpAt) {
      throw new AtlassianAuthError(
        'failed',
        'Another process is renewing the Atlassian sign-in. Please try again.',
      );
    }
    await sleep(retryMs);
  }
  try {
    return await run();
  } finally {
    await fs.rm(path, { force: true });
  }
}

/**
 * Tries once to take the lock, breaking it first if it was abandoned.
 * @param {string} path - The lock file.
 * @param {{ clock: { now: () => number }, fs: LockFs, staleMs: number }} deps - Clock, file system, stale age.
 * @returns {Promise<boolean>} True when the lock is now held.
 */
async function tryAcquire(path, { clock, fs, staleMs }) {
  try {
    const handle = await fs.open(path, CREATE_ONLY);
    await handle.close();
    return true;
  } catch (error) {
    if (codeOf(error) !== ALREADY_EXISTS) {
      throw error;
    }
  }
  await breakIfStale(path, { clock, fs, staleMs });
  return false;
}

/**
 * Removes a lock that has been held for longer than any renewal takes.
 * @param {string} path - The lock file.
 * @param {{ clock: { now: () => number }, fs: LockFs, staleMs: number }} deps - Clock, file system, stale age.
 * @returns {Promise<void>}
 */
async function breakIfStale(path, { clock, fs, staleMs }) {
  try {
    const { mtimeMs } = await fs.stat(path);
    if (clock.now() - mtimeMs >= staleMs) {
      await fs.rm(path, { force: true });
    }
  } catch (error) {
    // The holder released it between the two calls; the next attempt will take it.
    if (codeOf(error) !== NOT_FOUND) {
      throw error;
    }
  }
}
