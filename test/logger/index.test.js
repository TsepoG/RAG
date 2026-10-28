// @ts-check
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  DEFAULT_LOG_LEVEL,
  maskSecrets,
  REDACT_PATHS,
  REDACTED_VALUE,
} from '../../src/logger/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

/**
 * Builds a logger that writes into memory.
 * @param {import('../../src/logger/index.js').LoggerOptions} [options] - Overrides.
 * @returns {{ logger: import('../../src/logger/index.js').Logger, lines: () => Array<Record<string, unknown>> }} The logger and its captured output.
 */
function setup(options = {}) {
  const { stream, lines } = createMemoryStream();
  return { logger: createLogger({ ...options, destination: stream }), lines };
}

describe('createLogger levels', () => {
  it('drops lines below the configured level', () => {
    const { logger, lines } = setup({ level: 'info' });

    logger.debug('hidden');

    expect(lines()).toEqual([]);
  });

  it('emits lines at and above the configured level', () => {
    const { logger, lines } = setup({ level: 'debug' });

    logger.debug('shown');

    expect(lines().map((line) => line.msg)).toEqual(['shown']);
  });

  it('defaults to the info level', () => {
    const { logger, lines } = setup();

    logger.debug('hidden');
    logger.info('shown');

    expect(DEFAULT_LOG_LEVEL).toBe('info');
    expect(lines().map((line) => line.msg)).toEqual(['shown']);
  });
});

describe('createLogger output', () => {
  it('writes the level as a label', () => {
    const { logger, lines } = setup();

    logger.warn('careful');

    expect(lines()[0]).toMatchObject({ level: 'warn', msg: 'careful' });
  });

  it('adds the component name to every line', () => {
    const { logger, lines } = setup({ name: 'config' });

    logger.info('hello');

    expect(lines()[0]).toMatchObject({ name: 'config' });
  });

  it('omits the name field when no name is given', () => {
    const { logger, lines } = setup();

    logger.info('hello');

    expect(lines()[0]).not.toHaveProperty('name');
  });

  it('keeps fields that are not secrets', () => {
    const { logger, lines } = setup();

    logger.info({ port: 3000, user: { name: 'ada' } }, 'startup');

    expect(lines()[0]).toMatchObject({ port: 3000, user: { name: 'ada' } });
  });
});

describe('createLogger redaction', () => {
  const secretKeys = [
    'token',
    'apiToken',
    'githubToken',
    'authorization',
    'Authorization',
    'password',
    'accessToken',
    'refreshToken',
    'access_token',
    'refresh_token',
    'codeVerifier',
    'code_verifier',
  ];
  /** @type {Array<{ where: string, wrap: (secret: Record<string, string>) => object }>} */
  const depths = [
    { where: 'the top level', wrap: (secret) => secret },
    { where: 'one level deep', wrap: (secret) => ({ github: secret }) },
    { where: 'two levels deep', wrap: (secret) => ({ config: { github: secret } }) },
    { where: 'three levels deep', wrap: (secret) => ({ a: { b: { c: secret } } }) },
    { where: 'four levels deep', wrap: (secret) => ({ a: { b: { c: { d: secret } } } }) },
  ];
  const cases = secretKeys.flatMap((key) =>
    depths.map(({ where, wrap }) => ({ key, where, wrap })),
  );

  it.each(cases)('censors $key at $where', ({ key, wrap }) => {
    const { logger, lines } = setup();

    logger.info(wrap({ [key]: 'hunter2' }), 'with secret');

    const output = JSON.stringify(lines()[0]);
    expect(output).not.toContain('hunter2');
    expect(output).toContain(REDACTED_VALUE);
  });

  it('replaces the secret with the placeholder rather than removing the key', () => {
    const { logger, lines } = setup();

    logger.info({ token: 'hunter2', port: 3000 });

    expect(lines()[0]).toMatchObject({ token: '***', port: 3000 });
  });

  it('lists every secret key at five depths', () => {
    expect(REDACT_PATHS).toHaveLength(secretKeys.length * 5);
    expect(REDACT_PATHS).toContain('*.*.apiToken');
    expect(REDACT_PATHS).toContain('*.*.*.*.Authorization');
  });
});

describe('createLogger redaction of MCP server headers', () => {
  const basic = `Basic ${Buffer.from('dev@acme.example:atlassian-secret').toString('base64')}`;
  const bearer = 'Bearer github-secret';
  const mcpServers = {
    atlassian: {
      type: 'http',
      url: 'https://mcp.atlassian.com/v2/mcp',
      headers: { Authorization: basic },
      tools: ['search'],
    },
    github_repos: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: bearer, 'X-MCP-Readonly': 'true', 'X-MCP-Toolsets': 'repos' },
      tools: ['get_file_contents'],
    },
  };

  it.each([
    ['logged directly', { mcpServers }],
    ['logged inside a session config', { sessionConfig: { mcpServers } }],
  ])('never writes either Authorization value when %s', (_description, payload) => {
    const { logger, lines } = setup();

    logger.info(payload, 'session config');

    const output = JSON.stringify(lines()[0]);
    expect(output).not.toContain(basic);
    expect(output).not.toContain(bearer);
    expect(output).not.toContain('atlassian-secret');
    expect(output).not.toContain('github-secret');
  });

  it('keeps the headers and fields that are not secret', () => {
    const { logger, lines } = setup();

    logger.info({ mcpServers }, 'session config');

    expect(lines()[0]).toMatchObject({
      mcpServers: {
        atlassian: { url: 'https://mcp.atlassian.com/v2/mcp', tools: ['search'] },
        github_repos: { headers: { 'X-MCP-Readonly': 'true', 'X-MCP-Toolsets': 'repos' } },
      },
    });
  });
});

describe('maskSecrets', () => {
  const LIMIT = 300;

  it('masks every occurrence of a configured secret', () => {
    expect(maskSecrets('bad s3cret, retry with s3cret', ['s3cret'], LIMIT)).toBe(
      'bad ***, retry with ***',
    );
  });

  it('masks the longer secret first when one contains another', () => {
    expect(maskSecrets('value abc-long-secret', ['abc', 'abc-long-secret'], LIMIT)).toBe(
      'value ***',
    );
  });

  it('ignores an empty secret instead of masking everything', () => {
    expect(maskSecrets('nothing to hide', [''], LIMIT)).toBe('nothing to hide');
  });

  it.each([
    'Authorization: Bearer abc.def-123',
    'Authorization: Basic ZGV2QGFjbWU6c2VjcmV0',
    'token ghp_abcdefghijklmnop was rejected',
    'token gho_abcdefghijklmnop was rejected',
    'token github_pat_11ABCDEF_0123456789 was rejected',
    'token ATATT3xFfGF0abcdef-123= was rejected',
  ])('masks a credential-shaped value in %j', (text) => {
    const masked = maskSecrets(text, [], LIMIT);

    expect(masked).toContain(REDACTED_VALUE);
    expect(masked).not.toMatch(/abc.def|ZGV2|abcdefghijklmnop|0123456789|3xFfGF0/);
  });

  it('leaves ordinary text alone', () => {
    expect(maskSecrets('HTTP 404: page not found', ['s3cret'], LIMIT)).toBe(
      'HTTP 404: page not found',
    );
  });

  it('keeps text of exactly the limit, and cuts longer text with a marker', () => {
    expect(maskSecrets('x'.repeat(10), [], 10)).toBe('x'.repeat(10));
    expect(maskSecrets('x'.repeat(11), [], 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('masks before cutting, so a secret that straddles the limit leaves no fragment', () => {
    const text = `${'x'.repeat(8)}s3cret-value-here`;

    const masked = maskSecrets(text, ['s3cret-value-here'], 10);

    expect(masked).toBe(`${'x'.repeat(8)}***`.slice(0, 9) + '…');
    expect(masked).not.toContain('s3');
  });
});
