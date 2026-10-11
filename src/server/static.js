// @ts-check
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { AppError } from '../errors/index.js';

/** What the browser is told for each kind of file served. Any other kind is never served. */
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

/** The page served for `/`. */
const INDEX_PATH = '/index.html';

/** Files are checked against the server on every load so edits show up without a restart. */
const CACHE_CONTROL = 'no-cache';

/** HTTP status for a path that is not a listed file. */
const NOT_FOUND = 404;

/**
 * A file that may be served.
 * @typedef {{ file: string, type: string }} StaticFile
 */

/**
 * Lists the files under a folder that may be served, as the URL path each is served at.
 * Only this list is ever served, so a request cannot reach anything else.
 * @param {string} root - The folder, for example `public`.
 * @returns {Promise<ReadonlyMap<string, StaticFile>>} URL path to file and type.
 * @throws {AppError} When the folder cannot be read.
 */
export async function listStaticFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch((error) => {
    throw new AppError(`Cannot read the page's files in ${root}`, { cause: error });
  });
  /** @type {Map<string, StaticFile>} */
  const files = new Map();
  for (const entry of entries) {
    const type = CONTENT_TYPES.get(extname(entry.name));
    if (entry.isFile() && type !== undefined) {
      const file = join(entry.parentPath, entry.name);
      files.set(`/${relative(root, file).split(sep).join('/')}`, { file, type });
    }
  }
  return files;
}

/**
 * Builds the route handler that serves the listed files.
 * @param {ReadonlyMap<string, StaticFile>} files - From {@link listStaticFiles}.
 * @param {(file: string) => Promise<Buffer>} [read] - Reads a file; defaults to the file system.
 * @returns {import('fastify').RouteHandlerMethod} The handler.
 */
export function createStaticHandler(files, read = (file) => readFile(file)) {
  return async (request, reply) => {
    const path = request.url.split('?')[0];
    const entry = files.get(path === '/' ? INDEX_PATH : path);
    if (entry === undefined) {
      return reply.code(NOT_FOUND).send({ message: 'Not found' });
    }
    const body = await read(entry.file);
    return reply.type(entry.type).header('Cache-Control', CACHE_CONTROL).send(body);
  };
}
