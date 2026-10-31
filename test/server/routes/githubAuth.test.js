// @ts-check
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';
import { createConversationStore } from '../../../src/conversation/index.js';
import { GithubSignInRequiredError } from '../../../src/errors/index.js';
import { createLogger } from '../../../src/logger/index.js';
import { createAnswerMemory } from '../../../src/server/answers.js';
import { buildApp } from '../../../src/server/app.js';
import { createGithubAuth } from '../../../src/server/routes/githubAuth.js';
import { fakeRunner, START } from '../../helpers/conversationApp.js';
import { validEnv } from '../../helpers/env.js';
import { createMemoryStream } from '../../helpers/memory-stream.js';
import { makeRole } from '../../helpers/role.js';
import { JSON_HEADERS, OWN_HOST } from '../../helpers/server.js';

const FAKE_CLI_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';
const GH_CLI = Object.freeze({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined });

/**
 * A fake GitHub CLI token provider.
 * @param {object} [options] - How it behaves.
 * @param {Error} [options.failure] - What getGithubToken throws, if anything.
 * @returns {{ getGithubToken: import('vitest').Mock, invalidate: import('vitest').Mock, getLogin: import('vitest').Mock }} The fake.
 */
function cliTokens({ failure } = {}) {
  return {
    getGithubToken: vi.fn(async () => {
      if (failure !== undefined) {
        throw failure;
      }
      return FAKE_CLI_TOKEN;
    }),
    invalidate: vi.fn(),
    getLogin: vi.fn(async () => /** @type {string | undefined} */ ('TsepoG')),
  };
}

describe('createGithubAuth in token mode', () => {
  it('is always signed in, never refuses, and has nothing to check', async () => {
    const auth = createGithubAuth();

    expect(auth.mode).toBe('token');
    expect(await auth.status()).toEqual({ mode: 'token', signedIn: true });
    expect(await auth.check()).toEqual({ mode: 'token', signedIn: true });
    expect(await auth.refusal()).toBeUndefined();
  });
});

describe('createGithubAuth in gh-cli mode', () => {
  it('says who is logged in, and never gives the token', async () => {
    const status = await createGithubAuth({ tokens: cliTokens() }).status();

    expect(status).toEqual({ mode: 'gh-cli', signedIn: true, login: 'TsepoG' });
    expect(JSON.stringify(status)).not.toContain(FAKE_CLI_TOKEN);
  });

  it('leaves the login out when gh cannot say', async () => {
    const tokens = cliTokens();
    tokens.getLogin.mockResolvedValue(undefined);

    expect(await createGithubAuth({ tokens }).status()).toEqual({ mode: 'gh-cli', signedIn: true });
  });

  it.each(['logged-out', 'sso', 'cli-missing'])(
    'says why there is no token (%s)',
    async (reason) => {
      const failure = new GithubSignInRequiredError(
        /** @type {import('../../../src/errors/index.js').GithubSignInReason} */ (reason),
      );
      const auth = createGithubAuth({ tokens: cliTokens({ failure }) });

      expect(await auth.status()).toEqual({ mode: 'gh-cli', signedIn: false, reason });
      expect(await auth.refusal()).toEqual({
        code: 'github_signin_required',
        reason,
        message: failure.message,
      });
    },
  );

  it('forgets the cached token before checking again', async () => {
    const tokens = cliTokens();

    await createGithubAuth({ tokens }).check();

    expect(tokens.invalidate).toHaveBeenCalledOnce();
    expect(tokens.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      tokens.getGithubToken.mock.invocationCallOrder[0],
    );
  });

  it('does not refuse while there is a token', async () => {
    expect(await createGithubAuth({ tokens: cliTokens() }).refusal()).toBeUndefined();
  });

  it('passes on anything that is not a missing token', async () => {
    const auth = createGithubAuth({ tokens: cliTokens({ failure: new Error('broken') }) });

    await expect(auth.status()).rejects.toThrow('broken');
    await expect(auth.refusal()).rejects.toThrow('broken');
  });
});

/**
 * Builds an app with a conversation store and the given GitHub side.
 * @param {{ env?: Record<string, string | undefined>, githubAuth: import('../../../src/server/routes/githubAuth.js').GithubAuth }} options - The mode and the GitHub side.
 * @returns {{ app: import('fastify').FastifyInstance, ask: import('vitest').Mock }} The app and its double.
 */
function appWith({ env = GH_CLI, githubAuth }) {
  const ask = vi.fn(async () => {
    throw new Error('ask was not expected');
  });
  const app = buildApp({
    config: loadConfig(validEnv(env)),
    roles: new Map([['tester', makeRole()]]),
    ask,
    answers: createAnswerMemory(),
    saveFeedback: vi.fn(),
    conversations: {
      store: createConversationStore({
        clock: { now: () => START },
        limits: { maxTurns: 5, maxSourceChars: 1000, idleMinutes: 30 },
        closeSession: async () => undefined,
        newId: randomUUID,
      }),
      runner: fakeRunner([{}]),
      recheck: { manual: vi.fn(), auto: vi.fn() },
    },
    githubAuth,
    staticFiles: new Map(),
    logger: createLogger({ destination: createMemoryStream().stream }),
  });
  return { app, ask };
}

/**
 * Makes a request to the app with the usual headers.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {string} url - The path.
 * @param {object} [payload] - A JSON body; a GET when there is none.
 * @returns {Promise<import('light-my-request').Response>} The response.
 */
function call(app, url, payload) {
  return payload === undefined
    ? app.inject({ method: 'GET', url, headers: { host: OWN_HOST } })
    : app.inject({ method: 'POST', url, headers: JSON_HEADERS, payload });
}

describe('GET /api/auth/status with the GitHub side', () => {
  it('adds the GitHub block in token mode', async () => {
    const { app } = appWith({ env: {}, githubAuth: createGithubAuth() });

    expect((await call(app, '/api/auth/status')).json()).toEqual({
      mode: 'basic',
      signedIn: true,
      github: { mode: 'token', signedIn: true },
    });
  });

  it('adds who is logged in to the GitHub CLI, with no token anywhere', async () => {
    const { app } = appWith({ githubAuth: createGithubAuth({ tokens: cliTokens() }) });

    const response = await call(app, '/api/auth/status');

    expect(response.json().github).toEqual({ mode: 'gh-cli', signedIn: true, login: 'TsepoG' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(FAKE_CLI_TOKEN);
  });
});

describe('POST /api/auth/github/check', () => {
  it('checks the GitHub CLI again and answers with the whole status', async () => {
    const tokens = cliTokens();
    const { app } = appWith({ githubAuth: createGithubAuth({ tokens }) });

    const response = await call(app, '/api/auth/github/check', {});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'basic',
      signedIn: true,
      github: { mode: 'gh-cli', signedIn: true, login: 'TsepoG' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(tokens.invalidate).toHaveBeenCalledOnce();
    expect(response.body).not.toContain(FAKE_CLI_TOKEN);
  });

  it('refuses a body with anything in it', async () => {
    const { app } = appWith({ githubAuth: createGithubAuth({ tokens: cliTokens() }) });

    expect((await call(app, '/api/auth/github/check', { force: true })).statusCode).toBe(400);
  });

  it('does not exist in token mode', async () => {
    const { app } = appWith({ env: {}, githubAuth: createGithubAuth() });

    expect((await call(app, '/api/auth/github/check', {})).statusCode).toBe(404);
  });

  it('is guarded like every other API route', async () => {
    const { app } = appWith({ githubAuth: createGithubAuth({ tokens: cliTokens() }) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/github/check',
      headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('questions in gh-cli mode while the GitHub CLI has no token', () => {
  const failure = new GithubSignInRequiredError('logged-out', {
    cause: new Error(`gh printed ${FAKE_CLI_TOKEN}`),
  });

  it('cannot start a conversation: 401 github_signin_required', async () => {
    const { app } = appWith({ githubAuth: createGithubAuth({ tokens: cliTokens({ failure }) }) });

    const response = await call(app, '/api/conversations', { role: 'tester' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'github_signin_required',
      reason: 'logged-out',
      message: failure.message,
    });
  });

  it('cannot ask a single question, and the question is not asked', async () => {
    const { app, ask } = appWith({
      githubAuth: createGithubAuth({ tokens: cliTokens({ failure }) }),
    });

    const response = await call(app, '/api/ask', {
      question: 'Which tags does the code try?',
      role: 'tester',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('github_signin_required');
    expect(ask).not.toHaveBeenCalled();
    expect(response.body).not.toContain(FAKE_CLI_TOKEN);
  });

  it('can start a conversation once the CLI has a token', async () => {
    const { app } = appWith({ githubAuth: createGithubAuth({ tokens: cliTokens() }) });

    expect((await call(app, '/api/conversations', { role: 'tester' })).statusCode).toBe(200);
  });
});
