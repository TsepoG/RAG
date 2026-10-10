// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRuntimeEnv,
  encodeBasicCredentials,
  listSecrets,
  loadConfig,
  loadEnvFileIfPresent,
  redactConfig,
} from '../../src/config/index.js';
import { ConfigError } from '../../src/errors/index.js';
import {
  FAKE_ATLASSIAN_TOKEN,
  FAKE_COPILOT_TOKEN,
  FAKE_GITHUB_TOKEN,
  validEnv,
} from '../helpers/env.js';

/**
 * Runs loadConfig and returns the ConfigError it throws.
 * @param {Record<string, string | undefined>} env - Environment expected to be invalid.
 * @returns {ConfigError} The thrown error.
 */
function loadFailure(env) {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the parsed config for a valid environment', () => {
    const config = loadConfig(validEnv({ PORT: '4000' }));

    expect(config).toMatchObject({
      port: 4000,
      github: { repos: ['acme/app', 'acme/docs'] },
      atlassian: { spaceKeys: ['ENG', 'PROD'] },
    });
  });

  it('returns a deeply frozen object', () => {
    const config = loadConfig(validEnv());

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.github)).toBe(true);
    expect(Object.isFrozen(config.github.repos)).toBe(true);
    expect(Object.isFrozen(config.atlassian.spaceKeys)).toBe(true);
  });

  it('throws a ConfigError naming every invalid variable', () => {
    const error = loadFailure(validEnv({ GITHUB_TOKEN: undefined, PORT: 'abc' }));

    expect(error.issues.map((issue) => issue.path)).toEqual(['PORT', 'GITHUB_TOKEN']);
    expect(error.message).toContain('GITHUB_TOKEN: is required');
    expect(error.message).toContain('PORT: must be an integer between 1 and 65535');
  });

  it('keeps the validation failure as the cause', () => {
    expect(loadFailure({}).cause).toBeInstanceOf(Error);
  });

  it('never puts a secret value in the error', () => {
    const error = loadFailure(
      validEnv({
        GITHUB_REPOS: 'not a repo',
        PORT: 'x',
        ATLASSIAN_EMAIL: 'bad',
        COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN,
        ASK_TIMEOUT_MS: 'soon',
      }),
    );
    const everything = [error.message, JSON.stringify(error.issues), String(error.cause)].join(
      '\n',
    );

    expect(everything).not.toContain(FAKE_GITHUB_TOKEN);
    expect(everything).not.toContain(FAKE_ATLASSIAN_TOKEN);
    expect(everything).not.toContain(FAKE_COPILOT_TOKEN);
    expect(everything).not.toContain('not a repo');
    expect(everything).not.toContain('soon');
  });

  it('reads process.env when no environment is passed', () => {
    Object.entries(validEnv({ PORT: '4321' })).forEach(([name, value]) => {
      vi.stubEnv(name, value);
    });

    expect(loadConfig().port).toBe(4321);
  });
});

describe('redactConfig', () => {
  it('masks every secret', () => {
    const redacted = redactConfig(
      loadConfig(validEnv({ COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN })),
    );

    expect(redacted.github.token).toBe('***');
    expect(redacted.atlassian.apiToken).toBe('***');
    expect(redacted.copilot.githubToken).toBe('***');
    expect(JSON.stringify(redacted)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(JSON.stringify(redacted)).not.toContain(FAKE_ATLASSIAN_TOKEN);
    expect(JSON.stringify(redacted)).not.toContain(FAKE_COPILOT_TOKEN);
  });

  it('masks the API token in bearer mode too', () => {
    const redacted = redactConfig(
      loadConfig(validEnv({ ATLASSIAN_AUTH_MODE: 'bearer', ATLASSIAN_EMAIL: undefined })),
    );

    expect(redacted.atlassian.apiToken).toBe('***');
    expect(JSON.stringify(redacted)).not.toContain(FAKE_ATLASSIAN_TOKEN);
  });

  it('leaves the Copilot token unset when none is configured', () => {
    expect(redactConfig(loadConfig(validEnv())).copilot.githubToken).toBeUndefined();
  });

  it('keeps everything that is not a secret', () => {
    const config = loadConfig(validEnv({ COPILOT_MODEL: 'gpt-x' }));

    const redacted = redactConfig(config);

    expect(redacted.github.repos).toEqual(config.github.repos);
    expect(redacted.atlassian.auth).toEqual(config.atlassian.auth);
    expect(redacted.copilot.model).toBe('gpt-x');
    expect(redacted.port).toBe(config.port);
  });

  it('does not change the config it was given', () => {
    const config = loadConfig(validEnv({ COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN }));

    redactConfig(config);

    expect(config.github.token).toBe(FAKE_GITHUB_TOKEN);
    expect(config.atlassian.apiToken).toBe(FAKE_ATLASSIAN_TOKEN);
    expect(config.copilot.githubToken).toBe(FAKE_COPILOT_TOKEN);
  });
});

describe('encodeBasicCredentials', () => {
  it('encodes email:apiToken as base64', () => {
    expect(encodeBasicCredentials('dev@acme.example', 'secret')).toBe(
      Buffer.from('dev@acme.example:secret').toString('base64'),
    );
  });
});

describe('listSecrets', () => {
  it('lists the GitHub token, the Atlassian token and the encoded Basic credential', () => {
    const secrets = listSecrets(loadConfig(validEnv()));

    expect(secrets).toEqual([
      FAKE_GITHUB_TOKEN,
      FAKE_ATLASSIAN_TOKEN,
      encodeBasicCredentials('dev@acme.example', FAKE_ATLASSIAN_TOKEN),
    ]);
  });

  it('includes the Copilot token when one is configured', () => {
    const secrets = listSecrets(loadConfig(validEnv({ COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN })));

    expect(secrets).toContain(FAKE_COPILOT_TOKEN);
  });

  it('has no encoded credential in bearer mode, where there is no email to encode', () => {
    const config = loadConfig(
      validEnv({ ATLASSIAN_AUTH_MODE: 'bearer', ATLASSIAN_EMAIL: undefined }),
    );

    expect(listSecrets(config)).toEqual([FAKE_GITHUB_TOKEN, FAKE_ATLASSIAN_TOKEN]);
  });
});

describe('buildRuntimeEnv', () => {
  const withheld = [
    'GITHUB_TOKEN',
    'COPILOT_GITHUB_TOKEN',
    'GH_TOKEN',
    'GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN',
    'GITHUB_REPOS',
    'ATLASSIAN_SITE_URL',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_AUTH_MODE',
    'ATLASSIAN_API_TOKEN',
    'CONFLUENCE_SPACE_KEYS',
    'COPILOT_MODEL',
    'ASK_TIMEOUT_MS',
    'MAX_TOOL_CALLS',
    'MCP_TIMEOUT_MS',
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(withheld)('withholds %s from the runtime', (name) => {
    const runtimeEnv = buildRuntimeEnv({ [name]: 'secret-value', PATH: '/usr/bin' });

    expect(runtimeEnv).not.toHaveProperty(name);
  });

  it('withholds a credential whatever the case of its name (Windows)', () => {
    expect(buildRuntimeEnv({ gh_token: 'secret-value', Github_Token: 'secret-value' })).toEqual({});
  });

  it('keeps the variables the runtime needs to start', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/dev', NODE_ENV: 'test', LOG_LEVEL: 'debug' };

    expect(buildRuntimeEnv({ ...env, GITHUB_TOKEN: 'secret-value' })).toEqual(env);
  });

  it('drops variables that are unset', () => {
    expect(buildRuntimeEnv({ PATH: '/usr/bin', EMPTY: undefined })).toEqual({ PATH: '/usr/bin' });
  });

  it('returns a copy and leaves its input unchanged', () => {
    const input = { PATH: '/usr/bin', GITHUB_TOKEN: 'secret-value' };

    const runtimeEnv = buildRuntimeEnv(input);

    expect(input).toEqual({ PATH: '/usr/bin', GITHUB_TOKEN: 'secret-value' });
    expect(runtimeEnv).not.toBe(input);
  });

  it('reads process.env when no environment is passed', () => {
    vi.stubEnv('GITHUB_TOKEN', 'secret-value');
    vi.stubEnv('KEPT_BY_TEST', 'kept');

    const runtimeEnv = buildRuntimeEnv();

    expect(runtimeEnv).not.toHaveProperty('GITHUB_TOKEN');
    expect(runtimeEnv.KEPT_BY_TEST).toBe('kept');
  });
});

describe('loadEnvFileIfPresent', () => {
  it('loads the file and reports it when it exists', () => {
    const load = vi.fn();

    const loaded = loadEnvFileIfPresent({ path: 'custom.env', exists: () => true, load });

    expect(loaded).toBe(true);
    expect(load).toHaveBeenCalledExactlyOnceWith('custom.env');
  });

  it('does nothing when the file is missing', () => {
    const load = vi.fn();

    const loaded = loadEnvFileIfPresent({ exists: () => false, load });

    expect(loaded).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('looks for .env by default', () => {
    const exists = vi.fn(() => false);

    loadEnvFileIfPresent({ exists });

    expect(exists).toHaveBeenCalledExactlyOnceWith('.env');
  });

  it('uses the real file system by default and tolerates a missing file', () => {
    expect(loadEnvFileIfPresent({ path: 'no-such-file-for-this-test.env' })).toBe(false);
  });
});
