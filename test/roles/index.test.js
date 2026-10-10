// @ts-check
import { describe, expect, it } from 'vitest';
import * as roles from '../../src/roles/index.js';

describe('roles public entry point', () => {
  it('exports the loader, the lookup, the directory name and the schema', () => {
    expect(Object.keys(roles).sort()).toEqual([
      'ROLES_DIRECTORY',
      'getRole',
      'loadRoles',
      'roleSchema',
    ]);
  });
});
