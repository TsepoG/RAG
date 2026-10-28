// @ts-check
import { describe, expect, it } from 'vitest';
import { createLogger, redactAuthQuery } from '../../src/logger/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

/** A made-up authorization code and state; neither may ever reach a log line. */
const FAKE_CODE = 'fake-authorization-code-for-tests';
const FAKE_STATE = 'fake-state-for-tests';
const CALLBACK = `/auth/atlassian/callback?code=${FAKE_CODE}&state=${FAKE_STATE}`;

describe('redactAuthQuery', () => {
  it('masks the query of a sign-in path', () => {
    expect(redactAuthQuery(CALLBACK)).toBe('/auth/atlassian/callback?***');
  });

  it('masks the query of the bare /auth path', () => {
    expect(redactAuthQuery('/auth?code=x')).toBe('/auth?***');
  });

  it.each([
    ['a sign-in path without a query', '/auth/atlassian/start'],
    ['an API path', '/api/conversations?x=1'],
    ['a path that only starts with the same letters', '/authors?code=x'],
    ['the page', '/'],
  ])('leaves %s alone', (_label, url) => {
    expect(redactAuthQuery(url)).toBe(url);
  });

  it.each([undefined, 42, null])('leaves %j, which is not a string, alone', (value) => {
    expect(redactAuthQuery(value)).toBe(value);
  });
});

describe('createLogger with a sign-in URL', () => {
  it('never writes the code or the state logged under url', () => {
    const { stream, lines } = createMemoryStream();

    createLogger({ destination: stream }).info({ url: CALLBACK }, 'callback');

    const output = JSON.stringify(lines());
    expect(output).not.toContain(FAKE_CODE);
    expect(output).not.toContain(FAKE_STATE);
    expect(lines()[0]).toMatchObject({ url: '/auth/atlassian/callback?***' });
  });

  it('logs a request as its method and safe URL only', () => {
    const { stream, lines } = createMemoryStream();
    const request = { method: 'GET', url: CALLBACK, headers: { cookie: 'nonce=secret' } };

    createLogger({ destination: stream }).info({ req: request }, 'callback');

    const output = JSON.stringify(lines());
    expect(output).not.toContain(FAKE_CODE);
    expect(output).not.toContain('nonce=secret');
    expect(lines()[0]).toMatchObject({
      req: { method: 'GET', url: '/auth/atlassian/callback?***' },
    });
  });

  it('leaves a req that is not an object as it is', () => {
    const { stream, lines } = createMemoryStream();

    createLogger({ destination: stream }).info({ req: 'GET /' }, 'request');

    expect(lines()[0]).toMatchObject({ req: 'GET /' });
  });
});
