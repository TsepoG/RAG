// @ts-check
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_FILE,
  createSignInStore,
  DIRECTORY_MODE,
  FILE_MODE,
  SIGN_IN_FILE,
} from '../../src/atlassian/store.js';
import { AtlassianAuthError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

/** Windows ignores POSIX modes; there the files rely on the user profile's protection. */
const IS_WINDOWS = process.platform === 'win32';

/** @type {import('../../src/atlassian/store.js').StoredSignIn} */
const SIGN_IN = Object.freeze({
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  expiresAt: 1_700_000_000_000,
  scopes: ['read:confluence:agent-interface', 'search:confluence:agent-interface'],
  cloudId: '0f1e2d3c-4b5a-4968-8776-655443322110',
  siteHost: 'acme.atlassian.net',
});

/** @type {import('../../src/atlassian/store.js').StoredClient} */
const CLIENT = Object.freeze({
  issuer: 'https://auth.atlassian.com/tenant-id',
  clientId: 'client-123',
  redirectUri: 'http://127.0.0.1:3000/auth/atlassian/callback',
});

/** @type {string} */
let root;
/** @type {string} */
let dir;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'sign-in-store-'));
  dir = join(root, 'nested', '.role-aware-assistant');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * A store on the test folder, with its log.
 * @param {Partial<Parameters<typeof createSignInStore>[0]>} [overrides] - Dependencies to replace.
 * @returns {{ store: import('../../src/atlassian/store.js').SignInStore, lines: () => Array<Record<string, unknown>> }} The store and its log.
 */
function setup(overrides = {}) {
  const { stream, lines } = createMemoryStream();
  const store = createSignInStore({
    dir,
    logger: createLogger({ destination: stream }),
    ...overrides,
  });
  return { store, lines };
}

describe('createSignInStore reading and writing', () => {
  it('reads back the sign-in it wrote, creating the folder', async () => {
    const { store } = setup();

    await store.writeSignIn(SIGN_IN);

    expect(await store.readSignIn()).toEqual(SIGN_IN);
  });

  it('reads back the registration it wrote', async () => {
    const { store } = setup();

    await store.writeClient(CLIENT);

    expect(await store.readClient()).toEqual(CLIENT);
  });

  it('replaces a sign-in and leaves no temporary file behind', async () => {
    const { store } = setup();
    await store.writeSignIn(SIGN_IN);

    await store.writeSignIn({ ...SIGN_IN, accessToken: 'fake-newer-token' });

    expect((await store.readSignIn())?.accessToken).toBe('fake-newer-token');
    expect(await fs.readdir(dir)).toEqual([SIGN_IN_FILE]);
  });

  it('has nothing to read before anything is written, and logs nothing', async () => {
    const { store, lines } = setup();

    expect(await store.readSignIn()).toBeUndefined();
    expect(await store.readClient()).toBeUndefined();
    expect(lines()).toEqual([]);
  });

  it('keeps the lock file in the same folder', () => {
    expect(setup().store.lockPath).toBe(join(dir, 'atlassian-oauth.lock'));
  });
});

describe('createSignInStore with a damaged file', () => {
  it.each([
    ['not JSON', '{"accessToken": "fake-secret-token"'],
    ['the wrong shape', JSON.stringify({ accessToken: 'fake-secret-token' })],
  ])(
    'treats a sign-in file that is %s as signed out, without logging its content',
    async (_label, text) => {
      const { store, lines } = setup();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, SIGN_IN_FILE), text);

      expect(await store.readSignIn()).toBeUndefined();
      expect(lines()).toEqual([expect.objectContaining({ level: 'warn', file: SIGN_IN_FILE })]);
      expect(JSON.stringify(lines())).not.toContain('fake-secret-token');
    },
  );

  it('treats a sign-in file it cannot read as signed out, logging only the reason', async () => {
    const { store, lines } = setup();
    // A folder where the file should be cannot be read as a file.
    await fs.mkdir(join(dir, SIGN_IN_FILE), { recursive: true });

    expect(await store.readSignIn()).toBeUndefined();
    expect(lines()[0]).toMatchObject({ level: 'warn', file: SIGN_IN_FILE, code: 'EISDIR' });
  });
});

describe('createSignInStore file modes', () => {
  // POSIX modes only: Windows ignores them, which the README states plainly.
  it.skipIf(IS_WINDOWS)('makes the folder 0700 and the file 0600', async () => {
    const { store } = setup();

    await store.writeSignIn(SIGN_IN);

    expect((await fs.stat(dir)).mode & 0o777).toBe(DIRECTORY_MODE);
    expect((await fs.stat(join(dir, SIGN_IN_FILE))).mode & 0o777).toBe(FILE_MODE);
  });

  it.skipIf(IS_WINDOWS)('locks down a folder that already existed', async () => {
    await fs.mkdir(dir, { recursive: true, mode: 0o755 });
    const { store } = setup();

    await store.writeClient(CLIENT);

    expect((await fs.stat(dir)).mode & 0o777).toBe(DIRECTORY_MODE);
  });

  it('asks for the locked-down modes on every platform', async () => {
    /** @type {Array<[string, unknown]>} */
    const calls = [];
    const recording = {
      ...fs,
      mkdir: /** @type {typeof fs.mkdir} */ (
        /**
         * Records the options, then makes the folder.
         * @param {import('node:fs').PathLike} path - The folder.
         * @param {import('node:fs').MakeDirectoryOptions} options - The options.
         * @returns {Promise<string | undefined>} The first folder made.
         */
        async (path, options) => {
          calls.push(['mkdir', options]);
          return fs.mkdir(path, options);
        }
      ),
      /** @type {typeof fs.writeFile} */
      writeFile: async (path, data, options) => {
        calls.push(['writeFile', options]);
        return fs.writeFile(path, data, options);
      },
    };
    const { store } = setup({ fs: recording });

    await store.writeSignIn(SIGN_IN);

    expect(calls).toEqual([
      ['mkdir', { recursive: true, mode: 0o700 }],
      ['writeFile', { encoding: 'utf8', mode: 0o600, flag: 'wx' }],
    ]);
  });
});

describe('createSignInStore atomic writes', () => {
  it('keeps the old sign-in when the write is cut short before the rename', async () => {
    const { store } = setup();
    await store.writeSignIn(SIGN_IN);
    const crashing = {
      ...fs,
      /** @type {typeof fs.rename} */
      rename: async () => {
        throw new Error('simulated crash');
      },
    };

    await expect(
      setup({ fs: crashing }).store.writeSignIn({ ...SIGN_IN, accessToken: 'fake-lost-token' }),
    ).rejects.toThrow(AtlassianAuthError);

    expect(await store.readSignIn()).toEqual(SIGN_IN);
    expect(await fs.readdir(dir)).toEqual([SIGN_IN_FILE]);
  });

  it('leaves no partial file when writing the temporary file fails half way', async () => {
    const partial = {
      ...fs,
      /** @type {typeof fs.writeFile} */
      writeFile: async (path, _data, options) => {
        await fs.writeFile(path, '{"accessToken": "fake-half', options);
        throw new Error('disk full');
      },
    };

    const failure = setup({ fs: partial }).store.writeSignIn(SIGN_IN);

    await expect(failure).rejects.toThrow('The Atlassian sign-in could not be saved');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('keeps the reason as the cause', async () => {
    const reason = new Error('disk full');
    const failing = {
      ...fs,
      /** @type {typeof fs.writeFile} */
      writeFile: async () => {
        throw reason;
      },
    };

    await expect(setup({ fs: failing }).store.writeClient(CLIENT)).rejects.toMatchObject({
      reason: 'failed',
      cause: reason,
    });
  });
});

describe('createSignInStore deleting', () => {
  it('removes the sign-in and keeps the registration', async () => {
    const { store } = setup();
    await store.writeClient(CLIENT);
    await store.writeSignIn(SIGN_IN);

    await store.deleteSignIn();

    expect(await store.readSignIn()).toBeUndefined();
    expect(await store.readClient()).toEqual(CLIENT);
    expect(await fs.readdir(dir)).toEqual([CLIENT_FILE]);
  });

  it('does nothing when there is no sign-in', async () => {
    await expect(setup().store.deleteSignIn()).resolves.toBeUndefined();
  });
});

describe('createSignInStore forgetting the registration', () => {
  it('removes the registration and keeps the sign-in', async () => {
    const { store } = setup();
    await store.writeClient(CLIENT);
    await store.writeSignIn(SIGN_IN);

    await store.deleteClient();

    expect(await store.readClient()).toBeUndefined();
    expect(await store.readSignIn()).toEqual(SIGN_IN);
  });
});
