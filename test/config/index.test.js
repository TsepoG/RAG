// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, redactConfig } from '../../src/config/index.js';
import { ConfigError } from '../../src/errors/index.js';
import { FAKE_ATLASSIAN_TOKEN, FAKE_GITHUB_TOKEN, validEnv } from '../helpers/env.js';

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
      validEnv({ GITHUB_REPOS: 'not a repo', PORT: 'x', ATLASSIAN_EMAIL: 'bad' }),
    );
    const everything = [error.message, JSON.stringify(error.issues), String(error.cause)].join(
      '\n',
    );

    expect(everything).not.toContain(FAKE_GITHUB_TOKEN);
    expect(everything).not.toContain(FAKE_ATLASSIAN_TOKEN);
    expect(everything).not.toContain('not a repo');
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
    const redacted = redactConfig(loadConfig(validEnv()));

    expect(redacted.github.token).toBe('***');
    expect(redacted.atlassian.apiToken).toBe('***');
    expect(JSON.stringify(redacted)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(JSON.stringify(redacted)).not.toContain(FAKE_ATLASSIAN_TOKEN);
  });

  it('keeps everything that is not a secret', () => {
    const config = loadConfig(validEnv({ COPILOT_MODEL: 'gpt-x' }));

    const redacted = redactConfig(config);

    expect(redacted.github.repos).toEqual(config.github.repos);
    expect(redacted.atlassian.email).toBe(config.atlassian.email);
    expect(redacted.copilot.model).toBe('gpt-x');
    expect(redacted.port).toBe(config.port);
  });

  it('does not change the config it was given', () => {
    const config = loadConfig(validEnv());

    redactConfig(config);

    expect(config.github.token).toBe(FAKE_GITHUB_TOKEN);
    expect(config.atlassian.apiToken).toBe(FAKE_ATLASSIAN_TOKEN);
  });
});
