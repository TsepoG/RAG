// @ts-check
import { describe, expect, it } from 'vitest';
import { ConfigError, RoleNotFoundError } from '../../src/errors/index.js';
import { getRole, loadRoles, ROLES_DIRECTORY } from '../../src/roles/index.js';

const VALID_YAML = (/** @type {string} */ id) => `
id: ${id}
displayName: ${id} name
description: A one-line description.
audience: Someone.
depth: 2
vocabulary:
  - Do this.
bannedTerms: []
sourcePriority: [confluence, github]
answerShape:
  - A section.
examples:
  - question: Q?
    answer: A [C1].
version: 1
`;

/**
 * Builds the file system functions for a directory of in-memory files.
 * @param {Record<string, string>} files - File contents by file name.
 * @returns {{ readFile: (path: string) => Promise<string>, readdir: () => Promise<string[]> }} Fakes.
 */
function fakeDirectory(files) {
  return {
    readdir: async () => Object.keys(files),
    readFile: async (path) => {
      const name = path.split(/[\\/]/).at(-1) ?? '';
      return files[name];
    },
  };
}

/**
 * Loads from in-memory files and returns the error it throws.
 * @param {Record<string, string>} files - File contents by file name.
 * @returns {Promise<ConfigError>} The error.
 */
async function failure(files) {
  const error = await loadRoles({ dir: 'roles', ...fakeDirectory(files) }).catch((e) => e);
  expect(error).toBeInstanceOf(ConfigError);
  return error;
}

describe('loadRoles with the real role files', () => {
  it('loads the five roles the product ships with', async () => {
    const roles = await loadRoles({ dir: ROLES_DIRECTORY });

    expect([...roles.keys()]).toEqual([
      'business_analyst',
      'developer',
      'product_owner',
      'project_manager',
      'qa',
    ]);
  });

  it.each([
    ['developer', 3, ['github', 'confluence']],
    ['business_analyst', 2, ['confluence', 'github']],
    ['qa', 2, ['confluence', 'github']],
    ['product_owner', 1, ['confluence', 'github']],
    ['project_manager', 1, ['confluence', 'github']],
  ])('gives %s depth %i and the source order %j', async (id, depth, order) => {
    const role = getRole(await loadRoles({ dir: ROLES_DIRECTORY }), id);

    expect(role.depth).toBe(depth);
    expect(role.sourcePriority).toEqual(order);
    expect(role.version).toBeGreaterThanOrEqual(1);
  });

  it('words the banners for the roles that need their own, and leaves the rest to the defaults', async () => {
    const roles = await loadRoles({ dir: ROLES_DIRECTORY });

    expect(Object.keys(getRole(roles, 'product_owner').phrases ?? {}).sort()).toEqual([
      'high',
      'low',
      'medium',
      'notFound',
      'outOfScope',
    ]);
    expect(getRole(roles, 'project_manager').phrases).toEqual(
      getRole(roles, 'product_owner').phrases,
    );
    expect(Object.keys(getRole(roles, 'developer').phrases ?? {}).sort()).toEqual([
      'low',
      'medium',
      'notFound',
    ]);
    expect(getRole(roles, 'business_analyst').phrases).toBeUndefined();
    expect(getRole(roles, 'qa').phrases).toBeUndefined();
  });

  it('raised the version of each role whose wording changed', async () => {
    const roles = await loadRoles({ dir: ROLES_DIRECTORY });

    expect(
      ['developer', 'product_owner', 'project_manager'].map((id) => getRole(roles, id).version),
    ).toEqual([2, 2, 2]);
  });

  it('freezes the phrases like the rest of the role', async () => {
    const roles = await loadRoles({ dir: ROLES_DIRECTORY });

    expect(Object.isFrozen(getRole(roles, 'product_owner').phrases)).toBe(true);
  });

  it('bans technical terms for the two business-facing roles, and none for developers', async () => {
    const roles = await loadRoles({ dir: ROLES_DIRECTORY });

    expect(getRole(roles, 'product_owner').bannedTerms.length).toBeGreaterThan(0);
    expect(getRole(roles, 'project_manager').bannedTerms.length).toBeGreaterThan(0);
    expect(getRole(roles, 'developer').bannedTerms).toEqual([]);
  });
});

describe('loadRoles results', () => {
  it('returns roles in file-name order and ignores files that are not role files', async () => {
    const roles = await loadRoles({
      dir: 'roles',
      ...fakeDirectory({
        'b.yaml': VALID_YAML('b'),
        'README.md': 'not a role',
        'a.yml': VALID_YAML('a'),
      }),
    });

    expect([...roles.keys()]).toEqual(['a', 'b']);
  });

  it('freezes each role, including its lists', async () => {
    const roles = await loadRoles({
      dir: 'roles',
      ...fakeDirectory({ 'a.yaml': VALID_YAML('a') }),
    });
    const role = getRole(roles, 'a');

    expect(Object.isFrozen(role)).toBe(true);
    expect(Object.isFrozen(role.vocabulary)).toBe(true);
    expect(Object.isFrozen(role.examples[0])).toBe(true);
  });

  it('refuses every change to the catalogue', async () => {
    const roles = await loadRoles({
      dir: 'roles',
      ...fakeDirectory({ 'a.yaml': VALID_YAML('a') }),
    });
    const writable = /** @type {Map<string, unknown>} */ (roles);

    expect(() => writable.set('x', {})).toThrow('read-only');
    expect(() => writable.delete('a')).toThrow('read-only');
    expect(() => writable.clear()).toThrow('read-only');
    expect(roles.size).toBe(1);
  });

  it('reads the roles directory by default', async () => {
    expect((await loadRoles()).size).toBe(5);
  });
});

describe('loadRoles failures', () => {
  it('names the file and the field of an invalid role', async () => {
    const error = await failure({
      'a.yaml': VALID_YAML('a').replace('depth: 2', 'depth: 9'),
    });

    expect(error.issues).toEqual([{ path: 'a.yaml: depth', message: 'must be 1, 2 or 3' }]);
  });

  it('reports a missing field by name, with the file name', async () => {
    const error = await failure({ 'a.yaml': VALID_YAML('a').replace('audience: Someone.\n', '') });

    expect(error.message).toContain('a.yaml: audience: is required');
  });

  it('reports every problem in every file together', async () => {
    const error = await failure({
      'a.yaml': VALID_YAML('a').replace('depth: 2', 'depth: 9'),
      'b.yaml': VALID_YAML('b').replace('version: 1', 'version: 0'),
    });

    expect(error.issues.map(({ path }) => path)).toEqual(['a.yaml: depth', 'b.yaml: version']);
  });

  it('rejects a file whose id does not match its file name', async () => {
    const error = await failure({ 'a.yaml': VALID_YAML('b') });

    expect(error.issues).toEqual([{ path: 'a.yaml: id', message: 'must match the file name (a)' }]);
  });

  it('rejects two files with the same id', async () => {
    const error = await failure({ 'a.yaml': VALID_YAML('a'), 'a.yml': VALID_YAML('a') });

    expect(error.issues).toEqual([{ path: 'a.yml: id', message: 'is used by another role file' }]);
  });

  it('rejects a file that is not valid YAML, naming the file', async () => {
    const error = await failure({ 'a.yaml': 'id: [unclosed' });

    expect(error.issues[0].path).toBe('a.yaml');
    expect(error.issues[0].message).toMatch(/^is not valid YAML: /);
  });

  it('rejects a file that is valid YAML but not a role', async () => {
    const error = await failure({ 'a.yaml': 'just a sentence' });

    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues[0].path.startsWith('a.yaml')).toBe(true);
  });

  it('rejects a directory with no role files', async () => {
    const error = await failure({ 'README.md': 'nothing here' });

    expect(error.issues).toEqual([{ path: 'roles', message: 'has no role files (*.yaml)' }]);
  });

  it('rejects a file with a repeated key', async () => {
    const error = await loadRoles({
      dir: 'roles',
      readdir: async () => ['a.yaml'],
      readFile: async () => '{ a: 1, a: 2 }',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ConfigError);
  });
});

describe('getRole', () => {
  it('returns the role with that id', async () => {
    const roles = await loadRoles({
      dir: 'roles',
      ...fakeDirectory({ 'a.yaml': VALID_YAML('a') }),
    });

    expect(getRole(roles, 'a').id).toBe('a');
  });

  it('throws a typed error listing the valid ids for an unknown role', async () => {
    const roles = await loadRoles({
      dir: 'roles',
      ...fakeDirectory({ 'a.yaml': VALID_YAML('a'), 'b.yaml': VALID_YAML('b') }),
    });

    /** @type {any} */
    const error = (() => {
      try {
        return getRole(roles, 'z');
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(RoleNotFoundError);
    expect(error.message).toBe('Unknown role "z". Valid roles: a, b');
    expect(error.roleId).toBe('z');
    expect(error.validIds).toEqual(['a', 'b']);
  });
});
