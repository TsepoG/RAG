// @ts-check
import { describe, expect, it } from 'vitest';
import { configSchema, ENV_VARIABLE_NAMES } from '../../src/config/schema.js';
import { validEnv } from '../helpers/env.js';

/**
 * Parses an environment and returns the failures as `PATH: message` strings.
 * @param {Record<string, unknown>} env - Environment to validate.
 * @returns {string[]} One entry per issue, empty when the environment is valid.
 */
function failures(env) {
  const result = configSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('configSchema parsing', () => {
  it('maps a valid environment onto the nested config', () => {
    const result = configSchema.parse(
      validEnv({
        NODE_ENV: 'production',
        LOG_LEVEL: 'debug',
        PORT: '8080',
        COPILOT_MODEL: 'gpt-x',
        COPILOT_GITHUB_TOKEN: 'fake-copilot-token-for-tests',
        ASK_TIMEOUT_MS: '60000',
        MAX_TOOL_CALLS: '8',
        MCP_TIMEOUT_MS: '15000',
      }),
    );

    expect(result).toEqual({
      nodeEnv: 'production',
      logLevel: 'debug',
      port: 8080,
      github: { token: 'fake-github-token-for-tests', repos: ['acme/app', 'acme/docs'] },
      atlassian: {
        siteUrl: 'https://acme.atlassian.net',
        email: 'dev@acme.example',
        apiToken: 'fake-atlassian-token-for-tests',
        spaceKeys: ['ENG', 'PROD'],
      },
      copilot: {
        model: 'gpt-x',
        githubToken: 'fake-copilot-token-for-tests',
        askTimeoutMs: 60_000,
      },
      mcp: { maxToolCalls: 8, timeoutMs: 15_000 },
    });
  });

  it('applies defaults to the optional variables', () => {
    const result = configSchema.parse(validEnv());

    expect(result).toMatchObject({ nodeEnv: 'development', logLevel: 'info', port: 3000 });
    expect(result.copilot).toEqual({ askTimeoutMs: 120_000 });
    expect(result.mcp).toEqual({ maxToolCalls: 12, timeoutMs: 30_000 });
  });

  it('ignores variables it does not know about', () => {
    expect(failures(validEnv({ PATH: '/usr/bin', SOMETHING_ELSE: 'x' }))).toEqual([]);
  });
});

describe('configSchema required variables', () => {
  const required = [
    'GITHUB_TOKEN',
    'GITHUB_REPOS',
    'ATLASSIAN_SITE_URL',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_API_TOKEN',
    'CONFLUENCE_SPACE_KEYS',
  ];

  it.each(required)('reports %s by name when it is missing', (name) => {
    expect(failures(validEnv({ [name]: undefined }))).toEqual([`${name}: is required`]);
  });

  it.each(required)('reports %s when it is blank', (name) => {
    expect(failures(validEnv({ [name]: '   ' }))).toEqual([`${name}: must not be empty`]);
  });

  it('reports a value that is not a string', () => {
    // process.env only holds strings, but the schema is also usable with other inputs.
    expect(failures({ ...validEnv(), GITHUB_TOKEN: 42 })).toEqual([
      'GITHUB_TOKEN: must be a string',
    ]);
  });

  it('reports every missing variable at once', () => {
    const paths = failures({}).map((entry) => entry.split(':')[0]);

    expect(paths).toEqual(required);
  });
});

describe('configSchema GITHUB_REPOS', () => {
  it.each(['owner', 'a/b/c', 'bad repo/name', '/repo', 'owner/'])('rejects entry %j', (entry) => {
    expect(failures(validEnv({ GITHUB_REPOS: `acme/app,${entry}` }))).toEqual([
      'GITHUB_REPOS: every entry must look like owner/repo',
    ]);
  });

  it('trims entries and drops empty ones', () => {
    const { github } = configSchema.parse(validEnv({ GITHUB_REPOS: ' acme/app , ,acme/docs,' }));

    expect(github.repos).toEqual(['acme/app', 'acme/docs']);
  });

  it('rejects a list with no entries', () => {
    expect(failures(validEnv({ GITHUB_REPOS: ' , ,' }))).toEqual([
      'GITHUB_REPOS: must list at least one repository',
    ]);
  });
});

describe('configSchema CONFLUENCE_SPACE_KEYS', () => {
  it('rejects a list with no entries', () => {
    expect(failures(validEnv({ CONFLUENCE_SPACE_KEYS: ',' }))).toEqual([
      'CONFLUENCE_SPACE_KEYS: must list at least one space key',
    ]);
  });

  it('rejects an entry containing spaces', () => {
    expect(failures(validEnv({ CONFLUENCE_SPACE_KEYS: 'ENG,MY SPACE' }))).toEqual([
      'CONFLUENCE_SPACE_KEYS: every entry must not contain spaces',
    ]);
  });
});

describe('configSchema ATLASSIAN_SITE_URL', () => {
  // Built from a variable because the test needs an insecure scheme on purpose, to prove it is refused.
  const insecureScheme = 'http';
  const badUrls = [
    `${insecureScheme}://acme.atlassian.net`,
    'https://acme.example.com',
    'https://acme.atlassian.net/wiki',
    'acme',
  ];

  it.each(badUrls)('rejects %j', (url) => {
    expect(failures(validEnv({ ATLASSIAN_SITE_URL: url }))).toEqual([
      'ATLASSIAN_SITE_URL: must look like https://<site>.atlassian.net',
    ]);
  });

  it('removes a trailing slash', () => {
    const { atlassian } = configSchema.parse(
      validEnv({ ATLASSIAN_SITE_URL: 'https://acme.atlassian.net/' }),
    );

    expect(atlassian.siteUrl).toBe('https://acme.atlassian.net');
  });
});

describe('configSchema other fields', () => {
  it.each(['not-an-email', 'a@', '@b.co'])('rejects email %j', (email) => {
    expect(failures(validEnv({ ATLASSIAN_EMAIL: email }))).toEqual([
      'ATLASSIAN_EMAIL: must be a valid email address',
    ]);
  });

  it.each(['abc', '0', '70000', '-1', '1.5', '', '80 80'])(
    'rejects PORT %j with one message',
    (port) => {
      expect(failures(validEnv({ PORT: port }))).toEqual([
        'PORT: must be an integer between 1 and 65535',
      ]);
    },
  );

  it.each(['1', '3000', '65535'])('accepts PORT %s', (port) => {
    expect(configSchema.parse(validEnv({ PORT: port })).port).toBe(Number(port));
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(failures(validEnv({ NODE_ENV: 'staging' }))).toEqual([
      'NODE_ENV: must be one of development, test, production',
    ]);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(failures(validEnv({ LOG_LEVEL: 'loud' }))).toEqual([
      'LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent',
    ]);
  });

  it('rejects an empty COPILOT_MODEL when it is set', () => {
    expect(failures(validEnv({ COPILOT_MODEL: ' ' }))).toEqual([
      'COPILOT_MODEL: must not be empty when set',
    ]);
  });
});

describe('configSchema numeric settings', () => {
  const settings = [
    { name: 'PORT', min: 1, max: 65_535 },
    { name: 'ASK_TIMEOUT_MS', min: 5000, max: 600_000 },
    { name: 'MAX_TOOL_CALLS', min: 1, max: 50 },
    { name: 'MCP_TIMEOUT_MS', min: 1000, max: 120_000 },
  ];
  const rejections = settings.flatMap(({ name, min, max }) =>
    [String(min - 1), String(max + 1), 'abc', '1.5', '', '-1', '1 2'].map((value) => ({
      name,
      value,
      message: `${name}: must be an integer between ${min} and ${max}`,
    })),
  );

  it.each(settings)('accepts the lowest and highest $name', ({ name, min, max }) => {
    expect(failures(validEnv({ [name]: String(min) }))).toEqual([]);
    expect(failures(validEnv({ [name]: String(max) }))).toEqual([]);
  });

  it.each(rejections)('rejects $name=$value with one message', ({ name, value, message }) => {
    expect(failures(validEnv({ [name]: value }))).toEqual([message]);
  });
});

describe('configSchema COPILOT_GITHUB_TOKEN', () => {
  it('is optional', () => {
    expect(configSchema.parse(validEnv()).copilot.githubToken).toBeUndefined();
  });

  it('is trimmed when set', () => {
    const result = configSchema.parse(validEnv({ COPILOT_GITHUB_TOKEN: '  tok-123  ' }));

    expect(result.copilot.githubToken).toBe('tok-123');
  });

  it('rejects a blank value', () => {
    expect(failures(validEnv({ COPILOT_GITHUB_TOKEN: '   ' }))).toEqual([
      'COPILOT_GITHUB_TOKEN: must not be empty when set',
    ]);
  });
});

describe('ENV_VARIABLE_NAMES', () => {
  it('lists every variable the schema reads', () => {
    expect(ENV_VARIABLE_NAMES).toEqual(
      expect.arrayContaining([
        'GITHUB_TOKEN',
        'ATLASSIAN_API_TOKEN',
        'COPILOT_GITHUB_TOKEN',
        'ASK_TIMEOUT_MS',
        'MAX_TOOL_CALLS',
        'MCP_TIMEOUT_MS',
      ]),
    );
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ENV_VARIABLE_NAMES)).toBe(true);
  });
});
