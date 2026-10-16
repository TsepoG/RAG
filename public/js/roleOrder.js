// @ts-check

/**
 * The order the roles are listed in, as in the design and the README: from the one who works in the
 * code to the one who asks about progress. The server sends them by file name, which is not this.
 */
export const ROLE_ORDER = Object.freeze([
  'developer',
  'business_analyst',
  'qa',
  'product_owner',
  'project_manager',
]);

/**
 * Puts the roles in the order the page lists them: the known ones in {@link ROLE_ORDER}, then any
 * other, such as a role someone added, by name.
 * @template {{ id: string, displayName: string }} Role
 * @param {readonly Role[]} roles - The roles, in any order.
 * @returns {Role[]} A new list in the page's order.
 */
export function orderRoles(roles) {
  const rank = (/** @type {string} */ id) => {
    const index = ROLE_ORDER.indexOf(id);
    return index === -1 ? ROLE_ORDER.length : index;
  };
  return [...roles].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.displayName.localeCompare(b.displayName, 'en'),
  );
}
