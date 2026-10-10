// @ts-check
import { readdir as readDirectory, readFile as readTextFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parse } from 'yaml';
import { ConfigError, RoleNotFoundError } from '../errors/index.js';
import { roleSchema } from './schema.js';

/**
 * What `loadRoles` needs from the file system, replaceable in tests.
 * @typedef {object} LoaderOptions
 * @property {string} [dir] - Directory holding one YAML file per role.
 * @property {(path: string, encoding: 'utf8') => Promise<string>} [readFile] - Reads a file.
 * @property {(path: string) => Promise<string[]>} [readdir] - Lists a directory's file names.
 */

/**
 * The loaded roles by id. It cannot be changed after it is built.
 * @typedef {ReadonlyMap<string, import('./schema.js').Role>} RoleCatalog
 */

/** Where the role files live, relative to the working directory. */
export const ROLES_DIRECTORY = 'roles';

const ROLE_EXTENSIONS = new Set(['.yaml', '.yml']);
const READ_ONLY_MESSAGE = 'The role catalogue is read-only';

/**
 * A Map that refuses changes once it is built, so no code can alter a role for everyone else.
 * @augments {Map<string, import("./schema.js").Role>}
 */
class FrozenRoleMap extends Map {
  /**
   * Builds the map from its entries.
   * @param {Iterable<[string, import('./schema.js').Role]>} entries - The roles by id.
   */
  constructor(entries) {
    super();
    for (const [id, role] of entries) {
      super.set(id, role);
    }
  }

  /**
   * Refuses to add a role.
   * @returns {never} Never returns.
   * @throws {TypeError} Always.
   */
  set() {
    throw new TypeError(READ_ONLY_MESSAGE);
  }

  /**
   * Refuses to remove a role.
   * @returns {never} Never returns.
   * @throws {TypeError} Always.
   */
  delete() {
    throw new TypeError(READ_ONLY_MESSAGE);
  }

  /**
   * Refuses to remove every role.
   * @returns {never} Never returns.
   * @throws {TypeError} Always.
   */
  clear() {
    throw new TypeError(READ_ONLY_MESSAGE);
  }
}

/**
 * Freezes a role and everything inside it.
 * @template T
 * @param {T} value - The value.
 * @returns {T} The same value, now immutable.
 */
function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Reads and checks one role file.
 * @param {string} file - File name, for messages.
 * @param {string} source - The file's text.
 * @returns {{ role?: import('./schema.js').Role, issues: import('../errors/index.js').ConfigIssue[] }}
 *   The role, or the problems in it. Each problem names the file and the field.
 */
function checkRoleFile(file, source) {
  /** @type {unknown} */
  let data;
  try {
    data = parse(source);
  } catch (error) {
    // The yaml package throws errors whose message has several lines; the first says what is wrong.
    const reason = /** @type {Error} */ (error).message.split('\n')[0];
    return { issues: [{ path: file, message: `is not valid YAML: ${reason}` }] };
  }
  const result = roleSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map(({ path, message }) => ({
      path: [file, ...path].join(': '),
      message,
    }));
    return { issues };
  }
  const expectedId = basename(file, extname(file));
  if (result.data.id !== expectedId) {
    return {
      issues: [{ path: `${file}: id`, message: `must match the file name (${expectedId})` }],
    };
  }
  return { role: deepFreeze(result.data), issues: [] };
}

/**
 * Loads every role file in a directory and validates it. A problem names the file and the field,
 * and every problem in every file is reported together.
 * @param {LoaderOptions} [options] - The directory and, in tests, replacements for the file system.
 * @returns {Promise<RoleCatalog>} The roles by id, in file-name order, read-only.
 * @throws {ConfigError} When a file is invalid, two files share an id, or there are no role files.
 */
export async function loadRoles({
  dir = ROLES_DIRECTORY,
  readFile = readTextFile,
  readdir = readDirectory,
} = {}) {
  const files = (await readdir(dir))
    .filter((file) => ROLE_EXTENSIONS.has(extname(file)))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new ConfigError([{ path: dir, message: 'has no role files (*.yaml)' }]);
  }
  const checked = await Promise.all(
    files.map(async (file) => checkRoleFile(file, await readFile(join(dir, file), 'utf8'))),
  );
  /** @type {Map<string, import('./schema.js').Role>} */
  const roles = new Map();
  const issues = checked.flatMap((entry) => entry.issues);
  for (const [index, { role }] of checked.entries()) {
    if (role === undefined) {
      continue;
    }
    if (roles.has(role.id)) {
      issues.push({ path: `${files[index]}: id`, message: 'is used by another role file' });
    }
    roles.set(role.id, role);
  }
  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
  return new FrozenRoleMap(roles);
}

/**
 * Finds a role by id.
 * @param {RoleCatalog} roles - The loaded roles.
 * @param {string} id - The role id.
 * @returns {import('./schema.js').Role} The role.
 * @throws {RoleNotFoundError} When there is no such role; the message lists the valid ids.
 */
export function getRole(roles, id) {
  const role = roles.get(id);
  if (role === undefined) {
    throw new RoleNotFoundError(id, [...roles.keys()]);
  }
  return role;
}
