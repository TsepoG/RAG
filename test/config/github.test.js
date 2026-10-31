// @ts-check
import { describe, expect, it } from 'vitest';
import {
  buildGithubCliEnv,
  githubCliPath,
  githubTokenVariables,
  buildRuntimeEnv,
  configWarnings,
  IGNORED_GITHUB_TOKEN_WARNING,
  listSecrets,
  loadConfig,
  redactConfig,
} from '../../src/config/index.js';
import { configSchema, ENV_VARIABLE_NAMES } from '../../src/config/schema.js';
import { ConfigError } from '../../src/errors/index.js';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN, validEnv } from '../helpers/env.js';

/** An absolute path to gh on this platform. */
const GH_PATH = process.platform === 'win32' ? 'C:\\Tools\\gh\\gh.exe' : '/usr/local/bin/gh';

/**
 * A valid environment in gh-cli mode, with no GITHUB_TOKEN.
 * @param {Record<string, string | undefined>} [overrides] - Variables to change.
 * @returns {Record<string, string>} The environment.
 */
function ghCliEnv(overrides = {}) {
  return validEnv({ GITHUB_AUTH_MODE: 'gh-cli', GITHUB_TOKEN: undefined, ...overrides });
}

/**
 * Loads a config that should fail and returns the problems, by variable.
 * @param {Record<string, string>} env - The environment.
 * @returns {Array<{ path: string, message: string }>} The issues.
 */
function issuesOf(env) {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return [...error.issues];
    }
    throw error;
  }
  throw new Error('expected loadConfig to fail');
}

describe('token mode', () => {
  it('builds exactly the config it built before gh-cli mode existed', () => {
    // Recorded from main at 126f73d, before GITHUB_AUTH_MODE was added.
    expect(loadConfig(validEnv())).toStrictEqual({
      nodeEnv: 'development',
      logLevel: 'info',
      port: 3000,
      server: { host: '127.0.0.1', allowRemote: false },
      github: { token: FAKE_GITHUB_TOKEN, repos: ['acme/app', 'acme/docs'] },
      atlassian: {
        siteUrl: 'https://acme.atlassian.net',
        cloudId: undefined,
        auth: { mode: 'basic', email: 'dev@acme.example' },
        apiToken: FAKE_ATLASSIAN_TOKEN,
        spaceKeys: ['ENG', 'PROD'],
      },
      copilot: { model: undefined, githubToken: undefined, askTimeoutMs: 120_000 },
      mcp: { maxToolCalls: 12, timeoutMs: 30_000 },
      conversation: {
        maxTurns: 5,
        maxSourceChars: 250_000,
        idleMinutes: 30,
        recheckAfterMinutes: 15,
      },
    });
  });

  it('is what GITHUB_AUTH_MODE=token gives too', () => {
    expect(loadConfig(validEnv({ GITHUB_AUTH_MODE: 'token' }))).toStrictEqual(
      loadConfig(validEnv()),
    );
  });

  it('still requires GITHUB_TOKEN', () => {
    expect(issuesOf(validEnv({ GITHUB_TOKEN: undefined }))).toEqual([
      { path: 'GITHUB_TOKEN', message: 'is required' },
    ]);
  });

  it('adds no GitHub CLI settings to the config, even when GITHUB_CLI_PATH is set', () => {
    expect(loadConfig(validEnv({ GITHUB_CLI_PATH: GH_PATH })).github).toStrictEqual({
      token: FAKE_GITHUB_TOKEN,
      repos: ['acme/app', 'acme/docs'],
    });
  });
});

describe('gh-cli mode', () => {
  it('loads without GITHUB_TOKEN, with no token in the config and gh found through PATH', () => {
    expect(loadConfig(ghCliEnv()).github).toStrictEqual({
      mode: 'gh-cli',
      token: undefined,
      repos: ['acme/app', 'acme/docs'],
      cliPath: 'gh',
      tokenIgnored: false,
    });
  });

  it('uses GITHUB_CLI_PATH when it is set', () => {
    expect(loadConfig(ghCliEnv({ GITHUB_CLI_PATH: GH_PATH })).github.cliPath).toBe(GH_PATH);
  });

  it('ignores a GITHUB_TOKEN that is set, keeps it out of the config, and warns about it', () => {
    const config = loadConfig(ghCliEnv({ GITHUB_TOKEN: FAKE_GITHUB_TOKEN }));

    expect(config.github.token).toBeUndefined();
    expect(config.github.tokenIgnored).toBe(true);
    expect(JSON.stringify(config)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(configWarnings(config)).toEqual([IGNORED_GITHUB_TOKEN_WARNING]);
  });

  it('has no warning when GITHUB_TOKEN is unset or blank', () => {
    expect(configWarnings(loadConfig(ghCliEnv()))).toEqual([]);
    expect(configWarnings(loadConfig(ghCliEnv({ GITHUB_TOKEN: '  ' })))).toEqual([]);
  });

  it('still checks the shared settings and reports them with the others', () => {
    expect(issuesOf(ghCliEnv({ GITHUB_REPOS: 'not a repo', PORT: 'abc' }))).toEqual([
      { path: 'PORT', message: 'must be an integer between 1 and 65535' },
      { path: 'GITHUB_REPOS', message: 'every entry must look like owner/repo' },
    ]);
  });

  it('works with Atlassian oauth mode as well', () => {
    const config = loadConfig(
      ghCliEnv({
        ATLASSIAN_AUTH_MODE: 'oauth',
        ATLASSIAN_EMAIL: undefined,
        ATLASSIAN_API_TOKEN: undefined,
        ATLASSIAN_CLOUD_ID: '0f1e2d3c-4b5a-4968-8776-655443322110',
      }),
    );

    expect(config.github.mode).toBe('gh-cli');
    expect(config.atlassian.auth.mode).toBe('oauth');
  });
});

describe('the GitHub settings', () => {
  it.each(['GH-CLI', 'cli', ''])('rejects GITHUB_AUTH_MODE=%j', (mode) => {
    expect(issuesOf(validEnv({ GITHUB_AUTH_MODE: mode }))).toEqual([
      { path: 'GITHUB_AUTH_MODE', message: 'must be one of token, gh-cli' },
    ]);
  });

  it('reports a bad mode together with the other problems', () => {
    expect(issuesOf(validEnv({ GITHUB_AUTH_MODE: 'cli', PORT: 'abc' }))).toEqual([
      { path: 'PORT', message: 'must be an integer between 1 and 65535' },
      { path: 'GITHUB_AUTH_MODE', message: 'must be one of token, gh-cli' },
    ]);
  });

  it.each([
    ['', 'must not be empty when set'],
    ['   ', 'must not be empty when set'],
    ['gh', 'must be an absolute path to the gh program'],
    ['tools/gh.exe', 'must be an absolute path to the gh program'],
  ])('rejects GITHUB_CLI_PATH=%j', (path, message) => {
    expect(issuesOf(ghCliEnv({ GITHUB_CLI_PATH: path }))).toEqual([
      { path: 'GITHUB_CLI_PATH', message },
    ]);
  });

  it('are withheld from the Copilot runtime like every other setting', () => {
    expect(ENV_VARIABLE_NAMES).toEqual(
      expect.arrayContaining(['GITHUB_AUTH_MODE', 'GITHUB_CLI_PATH']),
    );
    expect(
      buildRuntimeEnv({ PATH: '/bin', GITHUB_AUTH_MODE: 'gh-cli', GITHUB_CLI_PATH: GH_PATH }),
    ).toEqual({ PATH: '/bin' });
  });
});

describe('an environment that is not an object', () => {
  it('is still rejected', () => {
    expect(configSchema.safeParse('not an environment').success).toBe(false);
  });
});

describe('redactConfig and listSecrets in gh-cli mode', () => {
  it('leaves the GitHub token unset, so the log does not suggest there is one', () => {
    expect(redactConfig(loadConfig(ghCliEnv())).github.token).toBeUndefined();
  });

  it('lists no GitHub token, because the CLI token is not part of the config', () => {
    expect(listSecrets(loadConfig(ghCliEnv({ GITHUB_TOKEN: FAKE_GITHUB_TOKEN })))).toEqual([
      FAKE_ATLASSIAN_TOKEN,
      Buffer.from(`dev@acme.example:${FAKE_ATLASSIAN_TOKEN}`).toString('base64'),
    ]);
  });
});

describe('buildGithubCliEnv', () => {
  it('keeps the environment gh needs but drops the variables that would replace its login', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/dev',
      GH_TOKEN: 'from-the-shell',
      GITHUB_TOKEN: FAKE_GITHUB_TOKEN,
      github_token: FAKE_GITHUB_TOKEN,
      EMPTY: undefined,
    };

    expect(buildGithubCliEnv(env)).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
    });
    expect(env.GITHUB_TOKEN).toBe(FAKE_GITHUB_TOKEN);
  });

  it('reads this process by default', () => {
    expect(buildGithubCliEnv()).not.toHaveProperty('GITHUB_TOKEN');
  });
});

describe('githubTokenVariables', () => {
  it('names the variables set that would replace the gh login, in upper case', () => {
    expect(
      githubTokenVariables({ PATH: '/bin', gh_token: 'x', GITHUB_TOKEN: 'y', GH_HOST: 'z' }),
    ).toEqual(['GH_TOKEN', 'GITHUB_TOKEN']);
    expect(githubTokenVariables({ GH_TOKEN: '', GITHUB_TOKEN: undefined })).toEqual([]);
  });

  it('reads this process by default', () => {
    expect(Array.isArray(githubTokenVariables())).toBe(true);
  });
});

describe('githubCliPath', () => {
  it('gives GITHUB_CLI_PATH in either mode, and gh otherwise', () => {
    expect(githubCliPath({ GITHUB_CLI_PATH: GH_PATH })).toBe(GH_PATH);
    expect(githubCliPath({})).toBe('gh');
    expect(githubCliPath({ GITHUB_CLI_PATH: 'relative/gh' })).toBe('gh');
  });

  it('reads this process by default', () => {
    expect(typeof githubCliPath()).toBe('string');
  });
});
