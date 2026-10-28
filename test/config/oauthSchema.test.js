// @ts-check
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultOauthDirectory,
  isInside,
  isOauthMode,
  OAUTH_HOST,
  OAUTH_MODE,
} from '../../src/config/oauthSchema.js';
import { configSchema, ENV_VARIABLE_NAMES } from '../../src/config/schema.js';
import { FAKE_ATLASSIAN_TOKEN, FAKE_CLOUD_ID, oauthEnv, validEnv } from '../helpers/env.js';

/** A folder outside the repository, as an absolute path. */
const OUTSIDE = join(tmpdir(), 'role-aware-assistant-sign-in');

/** A folder inside the repository; the tests run from its root. */
const INSIDE = resolve('data', 'sign-in');

/**
 * Parses an environment and returns the failures as `PATH: message` strings.
 * @param {Record<string, unknown>} env - Environment to validate.
 * @returns {string[]} One entry per issue, empty when the environment is valid.
 */
function failures(env) {
  const result = configSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('isInside', () => {
  const parent = resolve('/projects/app');

  it.each([
    ['the folder itself', parent],
    ['a folder below it', join(parent, 'data', 'x')],
    ['a folder whose name starts with two dots', join(parent, '..hidden')],
  ])('is true for %s', (_label, directory) => {
    expect(isInside(directory, parent)).toBe(true);
  });

  it.each([
    ['its parent', resolve('/projects')],
    ['a sibling', resolve('/projects/other')],
    ['a sibling sharing its name as a prefix', resolve('/projects/app-sign-in')],
  ])('is false for %s', (_label, directory) => {
    expect(isInside(directory, parent)).toBe(false);
  });
});

describe('defaultOauthDirectory', () => {
  it('is a hidden folder in the home directory', () => {
    expect(defaultOauthDirectory(resolve('/home/ada'))).toBe(
      join(resolve('/home/ada'), '.role-aware-assistant'),
    );
  });
});

describe('isOauthMode', () => {
  it('is true only when the mode is exactly oauth', () => {
    expect(OAUTH_MODE).toBe('oauth');
    expect(isOauthMode({ ATLASSIAN_AUTH_MODE: 'oauth' })).toBe(true);
    expect(isOauthMode({ ATLASSIAN_AUTH_MODE: 'OAuth' })).toBe(false);
    expect(isOauthMode({ ATLASSIAN_AUTH_MODE: 'bearer' })).toBe(false);
    expect(isOauthMode({})).toBe(false);
  });

  it.each([null, undefined, 'oauth', 42])('is false for a non-object %j', (input) => {
    expect(isOauthMode(input)).toBe(false);
  });
});

describe('configSchema in oauth mode', () => {
  it('needs no email and no API token, and keeps the sign-in in the home directory', () => {
    const result = configSchema.parse(oauthEnv());

    expect(result.atlassian).toEqual({
      siteUrl: 'https://acme.atlassian.net',
      cloudId: FAKE_CLOUD_ID,
      auth: { mode: 'oauth', dir: defaultOauthDirectory() },
      apiToken: undefined,
      spaceKeys: ['ENG', 'PROD'],
    });
  });

  it('ignores an API token that is still set, so it is never sent', () => {
    const result = configSchema.parse(oauthEnv({ ATLASSIAN_API_TOKEN: FAKE_ATLASSIAN_TOKEN }));

    expect(result.atlassian.apiToken).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(FAKE_ATLASSIAN_TOKEN);
  });

  it('keeps the sign-in in ATLASSIAN_OAUTH_DIR when it is set', () => {
    const result = configSchema.parse(oauthEnv({ ATLASSIAN_OAUTH_DIR: `  ${OUTSIDE}  ` }));

    expect(result.atlassian.auth).toEqual({ mode: 'oauth', dir: OUTSIDE });
  });

  it('shares every other setting with the other modes', () => {
    const oauth = configSchema.parse(oauthEnv({ PORT: '8080' }));
    const basic = configSchema.parse(validEnv({ PORT: '8080' }));

    expect({ ...oauth, atlassian: undefined }).toEqual({ ...basic, atlassian: undefined });
  });

  it('requires the cloud id, saying why', () => {
    expect(failures(oauthEnv({ ATLASSIAN_CLOUD_ID: undefined }))).toEqual([
      'ATLASSIAN_CLOUD_ID: is required when ATLASSIAN_AUTH_MODE is oauth',
    ]);
  });

  it('reports a missing cloud id together with other problems', () => {
    expect(failures(oauthEnv({ ATLASSIAN_CLOUD_ID: undefined, GITHUB_TOKEN: undefined }))).toEqual([
      'GITHUB_TOKEN: is required',
      'ATLASSIAN_CLOUD_ID: is required when ATLASSIAN_AUTH_MODE is oauth',
    ]);
  });

  it('rejects a cloud id that is not a UUID', () => {
    expect(failures(oauthEnv({ ATLASSIAN_CLOUD_ID: 'acme' }))).toEqual([
      'ATLASSIAN_CLOUD_ID: must look like a UUID',
    ]);
  });

  it('listens on 127.0.0.1 by default', () => {
    expect(configSchema.parse(oauthEnv()).server.host).toBe(OAUTH_HOST);
  });

  it.each(['localhost', '::1'])('refuses the host %s, saying why', (host) => {
    expect(failures(oauthEnv({ HOST: host }))).toEqual([
      'HOST: must be 127.0.0.1 when ATLASSIAN_AUTH_MODE is oauth, because Atlassian sends the sign-in back to http://127.0.0.1:<PORT>',
    ]);
  });

  it.each([
    ['blank', '   ', 'must not be empty when set'],
    ['relative', 'sign-in', 'must be an absolute path'],
    [
      'inside the project',
      INSIDE,
      'must be outside the project folder, so the sign-in can never be committed',
    ],
  ])('rejects a %s ATLASSIAN_OAUTH_DIR', (_label, dir, message) => {
    expect(failures(oauthEnv({ ATLASSIAN_OAUTH_DIR: dir }))).toEqual([
      `ATLASSIAN_OAUTH_DIR: ${message}`,
    ]);
  });
});

describe('configSchema in basic and bearer modes', () => {
  it.each(['basic', 'bearer'])(
    'ignores ATLASSIAN_OAUTH_DIR in %s mode, even when it is not valid',
    (mode) => {
      expect(
        failures(validEnv({ ATLASSIAN_AUTH_MODE: mode, ATLASSIAN_OAUTH_DIR: 'sign-in' })),
      ).toEqual([]);
    },
  );

  it('still needs the API token outside oauth mode', () => {
    expect(failures(validEnv({ ATLASSIAN_API_TOKEN: undefined }))).toEqual([
      'ATLASSIAN_API_TOKEN: is required',
    ]);
  });
});

describe('ENV_VARIABLE_NAMES', () => {
  it('includes the sign-in folder, so it is withheld from the Copilot runtime', () => {
    expect(ENV_VARIABLE_NAMES).toContain('ATLASSIAN_OAUTH_DIR');
  });
});
