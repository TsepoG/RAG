// @ts-check
import { access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import {
  AUTH_HELP,
  buildClientOptions,
  createCopilotClient,
  ensureAuthenticated,
} from '../../src/copilot/client.js';
import { CopilotError } from '../../src/errors/index.js';
import { createLogger } from '../../src/logger/index.js';
import { FAKE_COPILOT_TOKEN, FAKE_GITHUB_TOKEN, validEnv } from '../helpers/env.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const ROOT = join(tmpdir(), 'role-aware-copilot-test');
const BASE_DIRECTORY = join(ROOT, 'home');
const WORKING_DIRECTORY = join(ROOT, 'work');

/**
 * Builds a stand-in for the SDK's CopilotClient class that records how it is used.
 * @param {{ constructorError?: Error, startError?: Error, stopErrors?: Error[], stopError?: Error }} [behaviour]
 *   How the fake should misbehave.
 * @returns {any} A class to inject as ClientClass, with `instances` listing what was created.
 */
function fakeClientClass({ constructorError, startError, stopErrors = [], stopError } = {}) {
  return class FakeClient {
    static instances = /** @type {FakeClient[]} */ ([]);
    /** @param {Record<string, unknown>} options - What the client was created with. */
    constructor(options) {
      if (constructorError) {
        throw constructorError;
      }
      this.options = options;
      this.started = false;
      this.stopCalls = 0;
      FakeClient.instances.push(this);
    }
    async start() {
      if (startError) {
        throw startError;
      }
      this.started = true;
    }
    async stop() {
      this.stopCalls += 1;
      if (stopError) {
        throw stopError;
      }
      return stopErrors;
    }
  };
}

/**
 * Sets up a client with a fake SDK class, a fake file system and an in-memory logger.
 * @param {Record<string, any>} [overrides] - Dependencies and environment to replace.
 * @returns {{ ClientClass: any, calls: { made: string[], removed: string[] }, logs: () => Array<Record<string, unknown>>, start: () => Promise<import('../../src/copilot/client.js').CopilotHandle> }}
 *   The pieces and a function that starts the client.
 */
function setup(overrides = {}) {
  const { stream, lines } = createMemoryStream();
  const calls = { made: /** @type {string[]} */ ([]), removed: /** @type {string[]} */ ([]) };
  const ClientClass = overrides.ClientClass ?? fakeClientClass();
  const { envOverrides = {}, ...deps } = overrides;
  const config = loadConfig(validEnv(envOverrides));
  return {
    ClientClass,
    calls,
    logs: lines,
    start: () =>
      createCopilotClient(config, {
        logger: createLogger({ level: 'debug', destination: stream }),
        ClientClass,
        env: { PATH: '/usr/bin', GITHUB_TOKEN: FAKE_GITHUB_TOKEN, HOME: '/home/dev' },
        makeTempRoot: async () => ROOT,
        makeDirectory: async (path) => {
          calls.made.push(path);
        },
        removeDirectory: async (path) => {
          calls.removed.push(path);
        },
        ...deps,
      }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildClientOptions', () => {
  const paths = {
    baseDirectory: BASE_DIRECTORY,
    workingDirectory: WORKING_DIRECTORY,
    env: { PATH: '/usr/bin' },
  };

  it('runs in "empty" mode, so nothing ambient is switched on', () => {
    expect(buildClientOptions(loadConfig(validEnv()), paths).mode).toBe('empty');
  });

  it('uses the throwaway directories and the filtered environment it is given', () => {
    expect(buildClientOptions(loadConfig(validEnv()), paths)).toMatchObject(paths);
  });

  it('quietens the runtime and names the application', () => {
    expect(buildClientOptions(loadConfig(validEnv()), paths)).toMatchObject({
      logLevel: 'error',
      clientInfo: { applicationName: 'role-aware-assistant' },
    });
  });

  it('uses the logged-in user when no Copilot token is configured', () => {
    const options = buildClientOptions(loadConfig(validEnv()), paths);

    expect(options.useLoggedInUser).toBe(true);
    expect(options).not.toHaveProperty('gitHubToken');
  });

  it('uses the Copilot token when one is configured, and not the logged-in user', () => {
    const config = loadConfig(validEnv({ COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN }));
    const options = buildClientOptions(config, paths);

    expect(options.gitHubToken).toBe(FAKE_COPILOT_TOKEN);
    expect(options).not.toHaveProperty('useLoggedInUser');
  });

  it('never uses the MCP GitHub token as the Copilot credential', () => {
    expect(JSON.stringify(buildClientOptions(loadConfig(validEnv()), paths))).not.toContain(
      FAKE_GITHUB_TOKEN,
    );
  });
});

describe('createCopilotClient', () => {
  it('creates the data and working directories inside the temp directory', async () => {
    const { start, calls } = setup();

    await start();

    expect(calls.made).toEqual([BASE_DIRECTORY, WORKING_DIRECTORY]);
  });

  it('starts one client with the sandbox options and returns it with the working directory', async () => {
    const { start, ClientClass } = setup();

    const handle = await start();

    expect(ClientClass.instances).toHaveLength(1);
    expect(handle.client).toBe(ClientClass.instances[0]);
    expect(ClientClass.instances[0].started).toBe(true);
    expect(handle.workingDirectory).toBe(WORKING_DIRECTORY);
    expect(ClientClass.instances[0].options).toMatchObject({
      mode: 'empty',
      baseDirectory: BASE_DIRECTORY,
      workingDirectory: WORKING_DIRECTORY,
      useLoggedInUser: true,
    });
  });

  it('hands the runtime an environment without the MCP token or any app setting', async () => {
    const { start, ClientClass } = setup();

    await start();

    expect(ClientClass.instances[0].options.env).toEqual({ PATH: '/usr/bin', HOME: '/home/dev' });
  });

  it('filters the process environment when no environment is injected', async () => {
    vi.stubEnv('GITHUB_TOKEN', FAKE_GITHUB_TOKEN);
    vi.stubEnv('KEPT_FOR_TEST', 'kept');
    const { start, ClientClass } = setup({ env: undefined });

    await start();

    const { env } = ClientClass.instances[0].options;
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env.KEPT_FOR_TEST).toBe('kept');
  });

  it('passes the Copilot token only as the explicit gitHubToken option', async () => {
    const { start, ClientClass } = setup({
      envOverrides: { COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN },
    });

    await start();

    const { options } = ClientClass.instances[0];
    expect(options.gitHubToken).toBe(FAKE_COPILOT_TOKEN);
    expect(JSON.stringify(options.env)).not.toContain(FAKE_COPILOT_TOKEN);
  });

  it.each([
    ['the runtime fails to start', 'startError'],
    ['the client cannot be created', 'constructorError'],
  ])(
    'throws a CopilotError with the cause, and removes the temp directory, when %s',
    async (_name, fault) => {
      const cause = new Error('boom');
      const { start, calls } = setup({ ClientClass: fakeClientClass({ [fault]: cause }) });

      const failure = await start().catch((error) => error);

      expect(failure).toBeInstanceOf(CopilotError);
      expect(failure.message).toBe('Could not start the Copilot runtime');
      expect(failure.cause).toBe(cause);
      expect(calls.removed).toEqual([ROOT]);
    },
  );

  it('stops a client that started halfway before giving up', async () => {
    const ClientClass = fakeClientClass({ startError: new Error('handshake failed') });
    const { start } = setup({ ClientClass });

    await start().catch(() => undefined);

    expect(ClientClass.instances[0].stopCalls).toBe(1);
  });

  it('throws a CopilotError and cleans up when a directory cannot be created', async () => {
    const cause = new Error('EACCES');
    const { start, calls } = setup({
      makeDirectory: async () => {
        throw cause;
      },
    });

    const failure = await start().catch((error) => error);

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.cause).toBe(cause);
    expect(calls.removed).toEqual([ROOT]);
  });
});

describe('CopilotHandle.stop', () => {
  it('stops the client and removes the temp directory', async () => {
    const { start, calls, ClientClass } = setup();
    const handle = await start();

    await handle.stop();

    expect(ClientClass.instances[0].stopCalls).toBe(1);
    expect(calls.removed).toEqual([ROOT]);
  });

  it('does its work only once, however often it is called', async () => {
    const { start, calls, ClientClass } = setup();
    const handle = await start();

    await Promise.all([handle.stop(), handle.stop()]);
    await handle.stop();

    expect(ClientClass.instances[0].stopCalls).toBe(1);
    expect(calls.removed).toEqual([ROOT]);
  });

  it('logs errors the client reports while stopping, and still removes the directory', async () => {
    const { start, calls, logs } = setup({
      ClientClass: fakeClientClass({ stopErrors: [new Error('session close failed')] }),
    });
    const handle = await start();

    await handle.stop();

    expect(logs()).toEqual([
      expect.objectContaining({
        level: 'warn',
        msg: 'the Copilot client reported an error on stop',
        err: expect.objectContaining({ message: 'session close failed' }),
      }),
    ]);
    expect(calls.removed).toEqual([ROOT]);
  });

  it('does not throw when stopping the client fails, and still removes the directory', async () => {
    const { start, calls, logs } = setup({
      ClientClass: fakeClientClass({ stopError: new Error('kill failed') }),
    });
    const handle = await start();

    await expect(handle.stop()).resolves.toBeUndefined();

    expect(logs()[0]).toMatchObject({ level: 'warn', msg: 'stopping the Copilot client failed' });
    expect(calls.removed).toEqual([ROOT]);
  });

  it('does not throw when the directory cannot be removed (a locked file on Windows)', async () => {
    const { start, logs } = setup({
      removeDirectory: async () => {
        throw new Error('EBUSY');
      },
    });
    const handle = await start();

    await expect(handle.stop()).resolves.toBeUndefined();

    expect(logs()).toEqual([
      expect.objectContaining({
        level: 'warn',
        msg: 'could not remove the temporary directory',
        directory: ROOT,
      }),
    ]);
  });

  it('stops waiting for a directory that will not go, instead of blocking exit', async () => {
    const { start, logs } = setup({
      removeDirectory: () => new Promise(() => undefined),
      cleanupTimeoutMs: 20,
    });
    const handle = await start();

    await expect(handle.stop()).resolves.toBeUndefined();

    expect(logs()).toEqual([
      expect.objectContaining({
        level: 'warn',
        msg: 'temporary directory is still being removed; not waiting',
        directory: ROOT,
      }),
    ]);
  });
});

describe('createCopilotClient with the real file system', () => {
  it('creates real directories under the OS temp directory and removes them on stop', async () => {
    const { stream } = createMemoryStream();
    const handle = await createCopilotClient(loadConfig(validEnv()), {
      logger: createLogger({ destination: stream }),
      ClientClass: fakeClientClass(),
      env: { PATH: '/usr/bin' },
    });
    const root = join(handle.workingDirectory, '..');

    await expect(access(handle.workingDirectory)).resolves.toBeUndefined();
    await expect(readdir(root)).resolves.toEqual(['home', 'work']);
    expect(root.startsWith(tmpdir())).toBe(true);

    await handle.stop();

    await expect(access(root)).rejects.toThrow();
  });
});

describe('ensureAuthenticated', () => {
  it('returns the status when Copilot is signed in', async () => {
    const status = {
      isAuthenticated: true,
      authType: /** @type {const} */ ('gh-cli'),
      login: 'ada',
    };

    await expect(ensureAuthenticated({ getAuthStatus: async () => status })).resolves.toBe(status);
  });

  it('throws a CopilotError with login instructions when it is not signed in', async () => {
    const failure = await ensureAuthenticated({
      getAuthStatus: async () => ({ isAuthenticated: false }),
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.message).toBe(AUTH_HELP);
    expect(AUTH_HELP).toContain('gh auth login');
    expect(AUTH_HELP).toContain('COPILOT_GITHUB_TOKEN');
    expect(AUTH_HELP).toContain('Copilot Requests');
  });

  it('throws a CopilotError with the cause when the status cannot be read', async () => {
    const cause = new Error('rpc closed');

    const failure = await ensureAuthenticated({
      getAuthStatus: async () => {
        throw cause;
      },
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(CopilotError);
    expect(failure.message).toBe('Could not check whether Copilot is signed in');
    expect(failure.cause).toBe(cause);
  });
});
