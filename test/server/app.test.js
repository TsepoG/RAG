// @ts-check
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listStaticFiles } from '../../src/server/static.js';
import { buildTestApp, JSON_HEADERS, OWN_HOST, PORT } from '../helpers/server.js';

/** @type {string[]} */
const folders = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe('GET /api/health', () => {
  it('says the server is up', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({ url: '/api/health', headers: { host: OWN_HOST } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/roles', () => {
  it('lists each role with only what the page needs', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({ url: '/api/roles', headers: { host: OWN_HOST } });

    expect(response.json()).toEqual([
      { id: 'tester', displayName: 'Tester', description: 'A role for tests.', depth: 2 },
      { id: 'dev', displayName: 'Developer', description: 'A role for tests.', depth: 3 },
    ]);
  });
});

describe('the guards on the whole app', () => {
  it.each(['/api/health', '/api/roles'])('refuse a rebinding Host on %s', async (url) => {
    const { app } = buildTestApp();

    const response = await app.inject({ url, headers: { host: `evil.example:${PORT}` } });

    expect(response.statusCode).toBe(403);
  });

  it('refuse the cross-origin request from the brief with 403, and log the reason', async () => {
    const { app, lines } = buildTestApp();
    const evil = ['https', '://evil.example'].join('');

    const response = await app.inject({
      method: 'POST',
      url: '/api/ask',
      payload: '{}',
      headers: { ...JSON_HEADERS, origin: evil },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toHaveProperty('message');
    expect(lines()).toContainEqual(expect.objectContaining({ level: 'warn', reason: 'origin' }));
  });

  it('accept localhost as well as the loopback address', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({
      url: '/api/health',
      headers: { host: `localhost:${PORT}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('send the security headers on an error response too', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({ url: '/api/nope', headers: { host: OWN_HOST } });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('the page', () => {
  it('serves the files it was given, and the page at the root', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'app-'));
    folders.push(folder);
    await writeFile(join(folder, 'index.html'), '<h1>hello</h1>');
    const { app } = buildTestApp({ staticFiles: await listStaticFiles(folder) });

    const response = await app.inject({ url: '/', headers: { host: OWN_HOST } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<h1>hello</h1>');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('answers 404 for a file it does not have', async () => {
    const { app } = buildTestApp();

    const response = await app.inject({ url: '/missing.js', headers: { host: OWN_HOST } });

    expect(response.statusCode).toBe(404);
  });
});
