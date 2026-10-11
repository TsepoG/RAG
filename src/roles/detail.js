// @ts-check

/**
 * How much detail an answer goes into: the role's usual level, or one step more technical.
 * @typedef {'default' | 'more'} DetailLevel
 */

/**
 * A role as it is used for one question. When more detail was asked for, `detailLevel` is `more`
 * and the depth and banned words are the ones for that.
 * @typedef {import('./schema.js').Role & { detailLevel?: 'more' }} DetailedRole
 */

/** The names of the detail levels, for checking what a request asks for. */
export const DETAIL_LEVELS = Object.freeze(/** @type {const} */ (['default', 'more']));

/** The most technical depth a role can have. */
const MAX_DEPTH = 3;

/**
 * Gives a role the depth it has when the reader asks for more detail: one step more technical,
 * never beyond the most technical depth. From depth 2 up no word is banned, so a business role can
 * name the parts of the system once it is asked to. Everything else about the role is unchanged,
 * and the role itself is not modified. A role already at the most technical depth is returned as
 * it is.
 * @param {import('./schema.js').Role} role - The role profile.
 * @param {DetailLevel} detailLevel - The level asked for.
 * @returns {DetailedRole} The role to answer with.
 */
export function withDetailLevel(role, detailLevel) {
  if (detailLevel !== 'more' || role.depth >= MAX_DEPTH) {
    return role;
  }
  return Object.freeze({ ...role, depth: role.depth + 1, bannedTerms: [], detailLevel: 'more' });
}
