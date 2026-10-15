// @ts-check
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStaticHandler, listStaticFiles } from '../../src/server/static.js';

/** The first bytes of a woff2 file. */
const WOFF2_BYTES = Buffer.from('wOF2');

/** @type {string} */
let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'static-fonts-'));
  await mkdir(join(root, 'fonts'));
  await writeFile(join(root, 'fonts', 'Geist-Regular.woff2'), WOFF2_BYTES);
  await writeFile(join(root, 'fonts', 'OFL.txt'), 'the licence');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('serving the self-hosted fonts', () => {
  it('lists a woff2 file as font/woff2', async () => {
    const files = await listStaticFiles(root);

    expect(files.get('/fonts/Geist-Regular.woff2')?.type).toBe('font/woff2');
  });

  it('serves the font file with its type, byte for byte', async () => {
    const app = Fastify();
    app.get('/*', createStaticHandler(await listStaticFiles(root)));

    const response = await app.inject({ url: '/fonts/Geist-Regular.woff2' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('font/woff2');
    expect(response.rawPayload.equals(WOFF2_BYTES)).toBe(true);
  });

  it('keeps the licence text next to the fonts without serving it', async () => {
    const files = await listStaticFiles(root);

    expect(files.has('/fonts/OFL.txt')).toBe(false);
  });
});
