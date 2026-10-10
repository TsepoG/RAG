// @ts-check
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  DEFAULT_LOG_LEVEL,
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
  const secretKeys = ['token', 'apiToken', 'authorization', 'password'];
  /** @type {Array<{ where: string, wrap: (secret: Record<string, string>) => object }>} */
  const depths = [
    { where: 'the top level', wrap: (secret) => secret },
    { where: 'one level deep', wrap: (secret) => ({ github: secret }) },
    { where: 'two levels deep', wrap: (secret) => ({ config: { github: secret } }) },
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

  it('lists every secret key at three depths', () => {
    expect(REDACT_PATHS).toHaveLength(secretKeys.length * 3);
    expect(REDACT_PATHS).toContain('*.*.apiToken');
  });
});
