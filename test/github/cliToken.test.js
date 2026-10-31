// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import {
  createCliTokenProvider,
  GH_TIMEOUT_MS,
  LOGIN_ARGS,
  TOKEN_ARGS,
  TOKEN_CACHE_MS,
} from '../../src/github/index.js';
import { createLogger } from '../../src/logger/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const FAKE_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';
const OTHER_TOKEN = 'gho_OTHERotherOTHER0123456789abcdefXYZ';
const GH_ENV = Object.freeze({ PATH: '/usr/bin', HOME: '/home/dev' });

/**
 * A fake execFile that answers each gh command from a table, in turn.
 * @param {Record<string, Array<string | Error>>} answers - By the joined arguments: what to print, or
 *   an error to throw, for each call in order (the last one repeats).
 * @returns {import('vitest').Mock & import('../../src/github/cliToken.js').ExecFile} The fake.
 */
function fakeExecFile(answers) {
  /** @type {Record<string, number>} */
  const calls = {};
  return /** @type {any} */ (
    vi.fn(async (_file, args) => {
      const key = args.join(' ');
      const list = answers[key] ?? [new Error(`unexpected gh ${key}`)];
      const index = Math.min(calls[key] ?? 0, list.length - 1);
      calls[key] = (calls[key] ?? 0) + 1;
      const answer = list[index];
      if (answer instanceof Error) {
        throw answer;
      }
      return { stdout: answer, stderr: '' };
    })
  );
}

/**
 * An error as execFile gives it.
 * @param {Record<string, unknown>} fields - Its code, stderr and so on.
 * @returns {Error} The error.
 */
function execError(fields) {
  return Object.assign(new Error('Command failed'), fields);
}

/**
 * Builds a provider around fakes.
 * @param {object} [options] - What to change.
 * @param {Record<string, Array<string | Error>>} [options.answers] - What gh answers.
 * @param {string} [options.cliPath] - The gh program.
 * @returns {{ provider: import('../../src/github/index.js').CliTokenProvider, execFile: import('vitest').Mock, time: { value: number }, logs: () => string }} The provider and its fakes.
 */
function setup({ answers = { [TOKEN_ARGS.join(' ')]: [`${FAKE_TOKEN}\n`] }, cliPath } = {}) {
  const time = { value: 1_000_000 };
  const execFile = fakeExecFile(answers);
  const memory = createMemoryStream();
  const provider = createCliTokenProvider({
    ...(cliPath === undefined ? {} : { cliPath }),
    execFile,
    env: { ...GH_ENV },
    clock: { now: () => time.value },
    logger: createLogger({ destination: memory.stream }),
  });
  return { provider, execFile, time, logs: () => JSON.stringify(memory.lines()) };
}

describe('getGithubToken', () => {
  it('runs gh auth token for github.com with no shell, a time limit and the given environment', async () => {
    const { provider, execFile } = setup();

    expect(await provider.getGithubToken()).toBe(FAKE_TOKEN);
    expect(execFile).toHaveBeenCalledExactlyOnceWith('gh', TOKEN_ARGS, {
      env: GH_ENV,
      timeout: GH_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    });
    expect(TOKEN_ARGS).toEqual(['auth', 'token', '--hostname', 'github.com']);
    expect(TOKEN_ARGS).not.toContain('--show-token');
  });

  it('runs the program GITHUB_CLI_PATH names', async () => {
    const path = 'C:\\Tools\\gh\\gh.exe';
    const { provider, execFile } = setup({ cliPath: path });

    await provider.getGithubToken();

    expect(execFile.mock.calls[0][0]).toBe(path);
  });

  it('reuses the token for five minutes, then asks gh again', async () => {
    const { provider, execFile, time } = setup();
    await provider.getGithubToken();

    time.value += TOKEN_CACHE_MS - 1;
    await provider.getGithubToken();
    expect(execFile).toHaveBeenCalledTimes(1);

    time.value += 1;
    await provider.getGithubToken();
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('asks gh again when a fresh token is wanted, and picks up a new login', async () => {
    const { provider, execFile } = setup({
      answers: { [TOKEN_ARGS.join(' ')]: [FAKE_TOKEN, OTHER_TOKEN] },
    });
    await provider.getGithubToken();

    expect(await provider.getGithubToken({ fresh: true })).toBe(OTHER_TOKEN);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('asks gh once for callers that ask at the same time', async () => {
    const { provider, execFile } = setup();

    const tokens = await Promise.all([
      provider.getGithubToken(),
      provider.getGithubToken({ fresh: true }),
      provider.getGithubToken(),
    ]);

    expect(tokens).toEqual([FAKE_TOKEN, FAKE_TOKEN, FAKE_TOKEN]);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('asks gh again after invalidate', async () => {
    const { provider, execFile } = setup();
    await provider.getGithubToken();

    provider.invalidate();
    await provider.getGithubToken();

    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it.each(['ENOENT', 'EINVAL'])(
    'says the GitHub CLI is missing when it cannot be started (%s)',
    async (code) => {
      const { provider } = setup({
        answers: { [TOKEN_ARGS.join(' ')]: [execError({ code })] },
      });

      const error = await provider.getGithubToken().catch((caught) => caught);

      expect(error).toBeInstanceOf(GithubSignInRequiredError);
      expect(error.reason).toBe('cli-missing');
      expect(error.message).toBe('GitHub CLI not found — install it or set GITHUB_CLI_PATH.');
    },
  );

  it.each([
    [
      'gh exits with an error',
      execError({ code: 1, stderr: 'You are not logged into any GitHub hosts' }),
    ],
    ['gh takes too long', execError({ killed: true, signal: 'SIGTERM', code: null })],
  ])('says the CLI is not logged in when %s', async (_case, failure) => {
    const { provider } = setup({ answers: { [TOKEN_ARGS.join(' ')]: [failure] } });

    const error = await provider.getGithubToken().catch((caught) => caught);

    expect(error).toBeInstanceOf(GithubSignInRequiredError);
    expect(error.reason).toBe('logged-out');
    expect(error.cause).toBe(failure);
  });

  it.each(['', '  \n'])(
    'says the CLI is not logged in when gh prints nothing (%j)',
    async (out) => {
      const { provider } = setup({ answers: { [TOKEN_ARGS.join(' ')]: [out] } });

      await expect(provider.getGithubToken()).rejects.toMatchObject({ reason: 'logged-out' });
    },
  );

  it('does not keep a failure: the next call asks gh again', async () => {
    const { provider } = setup({
      answers: { [TOKEN_ARGS.join(' ')]: [execError({ code: 1 }), FAKE_TOKEN] },
    });
    await provider.getGithubToken().catch(() => undefined);

    expect(await provider.getGithubToken()).toBe(FAKE_TOKEN);
  });

  it('logs why gh failed, with any token masked, and never puts a token in the error', async () => {
    const { provider, logs } = setup({
      answers: {
        [TOKEN_ARGS.join(' ')]: [execError({ code: 1, stderr: `bad token ${FAKE_TOKEN}` })],
      },
    });

    const error = await provider.getGithubToken().catch((caught) => caught);

    expect(logs()).toContain('could not get a token from the GitHub CLI');
    expect(logs()).toContain('logged-out');
    expect(logs()).not.toContain(FAKE_TOKEN);
    expect(error.message).not.toContain(FAKE_TOKEN);
  });

  it('logs the error itself when gh printed nothing to stderr', async () => {
    const { provider, logs } = setup({
      answers: { [TOKEN_ARGS.join(' ')]: [execError({ code: 'ENOENT' })] },
    });

    await provider.getGithubToken().catch(() => undefined);

    expect(logs()).toContain('Command failed');
  });

  it('works without a logger', async () => {
    const provider = createCliTokenProvider({
      execFile: fakeExecFile({ [TOKEN_ARGS.join(' ')]: [execError({ code: 1 })] }),
      env: {},
    });

    await expect(provider.getGithubToken()).rejects.toMatchObject({ reason: 'logged-out' });
  });
});

describe('the defaults', () => {
  it('times the cache with the real clock', async () => {
    const execFile = fakeExecFile({ [TOKEN_ARGS.join(' ')]: [FAKE_TOKEN] });
    const provider = createCliTokenProvider({ execFile, env: {} });

    await provider.getGithubToken();
    await provider.getGithubToken();

    expect(execFile).toHaveBeenCalledTimes(1);
  });
});

describe('getLogin', () => {
  const login = LOGIN_ARGS.join(' ');
  const token = TOKEN_ARGS.join(' ');

  it('asks gh for the account name once for each token', async () => {
    const { provider, execFile } = setup({
      answers: { [token]: [FAKE_TOKEN, OTHER_TOKEN], [login]: ['TsepoG\n', 'Other\n'] },
    });

    expect(await provider.getLogin()).toBe('TsepoG');
    expect(await provider.getLogin()).toBe('TsepoG');
    expect(execFile.mock.calls.filter(([, args]) => args.join(' ') === login)).toHaveLength(1);

    await provider.getGithubToken({ fresh: true });
    expect(await provider.getLogin()).toBe('Other');
    expect(LOGIN_ARGS).toEqual(['api', 'user', '--jq', '.login']);
  });

  it('gives no name when gh prints none, or cannot say, and logs why', async () => {
    const empty = setup({ answers: { [token]: [FAKE_TOKEN], [login]: [''] } });
    const failing = setup({
      answers: { [token]: [FAKE_TOKEN], [login]: [execError({ code: 1, stderr: 'HTTP 403' })] },
    });

    expect(await empty.provider.getLogin()).toBeUndefined();
    expect(await failing.provider.getLogin()).toBeUndefined();
    expect(failing.logs()).toContain('could not read the GitHub CLI account name');
  });

  it('needs a token first, so a logged-out CLI is a sign-in error', async () => {
    const { provider } = setup({ answers: { [token]: [execError({ code: 1 })] } });

    await expect(provider.getLogin()).rejects.toBeInstanceOf(GithubSignInRequiredError);
  });
});
