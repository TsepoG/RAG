// @ts-check
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStaticHandler, listStaticFiles } from '../../src/server/static.js';

/** @type {string} */
let base;
/** @type {string} */
let root;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'static-'));
  root = join(base, 'public');
  await mkdir(join(root, 'css'), { recursive: true });
  await mkdir(join(root, 'js'));
  await writeFile(join(root, 'index.html'), '<h1>page</h1>');
  await writeFile(join(root, 'css', 'app.css'), 'body{}');
  await writeFile(join(root, 'js', 'main.js'), 'export {};');
  await writeFile(join(root, 'notes.txt'), 'not served');
  await writeFile(join(base, 'secret.json'), '{"secret":true}');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * An app serving the folder.
 * @returns {Promise<import('fastify').FastifyInstance>} The app.
 */
async function appServing() {
  const app = Fastify();
  app.get('/*', createStaticHandler(await listStaticFiles(root)));
  await app.ready();
  return app;
}

describe('listStaticFiles', () => {
  it('lists the served files by the URL path each is served at', async () => {
    const files = await listStaticFiles(root);

    expect([...files.keys()].sort()).toEqual(['/css/app.css', '/index.html', '/js/main.js']);
  });

  it('gives each file its content type', async () => {
    const files = await listStaticFiles(root);

    expect(files.get('/css/app.css')?.type).toBe('text/css; charset=utf-8');
    expect(files.get('/js/main.js')?.type).toBe('text/javascript; charset=utf-8');
    expect(files.get('/index.html')?.type).toBe('text/html; charset=utf-8');
  });

  it('says so, with the cause, when the folder does not exist', async () => {
    const failure = await listStaticFiles(join(base, 'missing')).catch((error) => error);

    expect(failure.message).toContain("Cannot read the page's files");
    expect(failure.cause.code).toBe('ENOENT');
  });

  it('leaves out a kind of file it has no type for', async () => {
    const files = await listStaticFiles(root);

    expect(files.has('/notes.txt')).toBe(false);
  });

  it('leaves out a link to a file outside the folder', async () => {
    try {
      await symlink(join(base, 'secret.json'), join(root, 'link.css'));
    } catch {
      return; // Creating links needs a privilege some machines do not grant.
    }

    expect((await listStaticFiles(root)).has('/link.css')).toBe(false);
  });
});

describe('createStaticHandler', () => {
  it('serves the page for the root path', async () => {
    const app = await appServing();

    const response = await app.inject({ url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<h1>page</h1>');
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('serves a file with its type, and says to check it again each time', async () => {
    const app = await appServing();

    const response = await app.inject({ url: '/css/app.css?v=2' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('body{}');
    expect(response.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('reads the file again on each request, so an edit shows without a restart', async () => {
    const app = await appServing();
    await writeFile(join(root, 'css', 'app.css'), 'body{color:red}');

    expect((await app.inject({ url: '/css/app.css' })).body).toBe('body{color:red}');
  });

  it.each([
    '/nope.html',
    '/notes.txt',
    '/css',
    '/css/',
    '/../secret.json',
    '/..%2fsecret.json',
    '/%2e%2e/secret.json',
    '/css/../../secret.json',
    '/css/%2e%2e/%2e%2e/secret.json',
    '/js\\..\\..\\secret.json',
    '/INDEX.HTML',
  ])('answers 404 for %s', async (path) => {
    const app = await appServing();

    const response = await app.inject({ url: path });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('secret');
  });

  it('answers with JSON when a file is missing', async () => {
    const app = await appServing();

    const response = await app.inject({ url: '/missing.js' });

    expect(response.json()).toEqual({ message: 'Not found' });
  });
});
