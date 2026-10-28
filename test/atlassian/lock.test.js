// @ts-check
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STALE_LOCK_MS, withLock } from '../../src/atlassian/lock.js';
import { AtlassianAuthError } from '../../src/errors/index.js';

const SYSTEM_CLOCK = { now: () => Date.now() };

/** Short timings, so a test that waits does not wait long. */
const QUICK = Object.freeze({ clock: SYSTEM_CLOCK, retryMs: 5, waitMs: 2000 });

/** @type {string} */
let dir;
/** @type {string} */
let lockPath;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'sign-in-lock-'));
  lockPath = join(dir, 'atlassian-oauth.lock');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Whether a file exists.
 * @param {string} path - The file.
 * @returns {Promise<boolean>} True when it does.
 */
async function exists(path) {
  return fs.stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * An error with a file-system code.
 * @param {string} code - The code.
 * @returns {Error & { code: string }} The error.
 */
function fsError(code) {
  return Object.assign(new Error(code), { code });
}

describe('withLock', () => {
  it('holds the lock while running and removes it afterwards', async () => {
    const result = await withLock(lockPath, async () => exists(lockPath), QUICK);

    expect(result).toBe(true);
    expect(await exists(lockPath)).toBe(false);
  });

  it('removes the lock when the work fails', async () => {
    const failing = withLock(
      lockPath,
      async () => {
        throw new Error('refresh failed');
      },
      QUICK,
    );

    await expect(failing).rejects.toThrow('refresh failed');
    expect(await exists(lockPath)).toBe(false);
  });

  it('lets only one holder in at a time, as two processes sharing a folder would', async () => {
    /** @type {string[]} */
    const events = [];
    const hold = (/** @type {string} */ name) =>
      withLock(
        lockPath,
        async () => {
          events.push(`${name} in`);
          await new Promise((resolve) => setTimeout(resolve, 30));
          events.push(`${name} out`);
        },
        QUICK,
      );

    await Promise.all([hold('first'), hold('second')]);

    // Either may win, but each must be done before the other comes in.
    const [winner, loser] = events[0].startsWith('first')
      ? ['first', 'second']
      : ['second', 'first'];
    expect(events).toEqual([`${winner} in`, `${winner} out`, `${loser} in`, `${loser} out`]);
  });

  it('gives up when the lock stays held, and leaves the holder its lock', async () => {
    await fs.writeFile(lockPath, '');

    const waiting = withLock(lockPath, async () => 'ran', { ...QUICK, waitMs: 20 });

    await expect(waiting).rejects.toThrow(AtlassianAuthError);
    expect(await exists(lockPath)).toBe(true);
  });

  it('breaks a lock left behind by a process that died', async () => {
    await fs.writeFile(lockPath, '');
    const later = { now: () => Date.now() + STALE_LOCK_MS };

    const result = await withLock(lockPath, async () => 'ran', { ...QUICK, clock: later });

    expect(result).toBe('ran');
    expect(STALE_LOCK_MS).toBe(30_000);
  });

  it('passes on a failure to create the lock other than it being held', async () => {
    const missingFolder = join(dir, 'missing', 'atlassian-oauth.lock');

    await expect(withLock(missingFolder, async () => 'ran', QUICK)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('passes on something thrown that is not an error', async () => {
    const odd = {
      ...fs,
      /** @type {typeof fs.open} */
      open: async () => {
        throw 'not an error';
      },
    };

    await expect(withLock(lockPath, async () => 'ran', { ...QUICK, fs: odd })).rejects.toBe(
      'not an error',
    );
  });

  it('tries again when the holder lets go between the two checks', async () => {
    let attempts = 0;
    const racing = {
      ...fs,
      /** @type {typeof fs.open} */
      open: async (path, flags) => {
        attempts += 1;
        if (attempts === 1) {
          throw fsError('EEXIST');
        }
        return fs.open(path, flags);
      },
      /** @type {typeof fs.stat} */
      stat: async () => {
        throw fsError('ENOENT');
      },
    };

    const result = await withLock(lockPath, async () => 'ran', { ...QUICK, fs: racing });

    expect(result).toBe('ran');
    expect(attempts).toBe(2);
  });

  it('passes on a failure to look at the held lock', async () => {
    const broken = {
      ...fs,
      /** @type {typeof fs.open} */
      open: async () => {
        throw fsError('EEXIST');
      },
      /** @type {typeof fs.stat} */
      stat: async () => {
        throw fsError('EACCES');
      },
    };

    await expect(
      withLock(lockPath, async () => 'ran', { ...QUICK, fs: broken }),
    ).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('waits with the default sleep between attempts', async () => {
    await fs.writeFile(lockPath, '');
    setTimeout(() => {
      fs.rm(lockPath, { force: true });
    }, 20);

    const result = await withLock(lockPath, async () => 'ran', { clock: SYSTEM_CLOCK });

    expect(result).toBe('ran');
  });
});
