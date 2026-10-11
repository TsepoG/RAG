// @ts-check

/** @typedef {import('./schema.js').Role} Role */
/** @typedef {import('./detail.js').DetailedRole} DetailedRole */
/** @typedef {import('./detail.js').DetailLevel} DetailLevel */

export { DETAIL_LEVELS, withDetailLevel } from './detail.js';
export { getRole, loadRoles, ROLES_DIRECTORY } from './loader.js';
export { roleSchema } from './schema.js';
