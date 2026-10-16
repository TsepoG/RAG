// @ts-check
import { describe, expect, it } from 'vitest';
import { orderRoles, ROLE_ORDER } from '../../../public/js/roleOrder.js';

/**
 * Makes a role with the parts the order looks at.
 * @param {string} id - Its id.
 * @param {string} [displayName] - Its name.
 * @returns {{ id: string, displayName: string }} The role.
 */
const role = (id, displayName = id) => ({ id, displayName });

describe('orderRoles', () => {
  it('lists the known roles as the design does, whatever order the server sent them in', () => {
    const fromServer = ['business_analyst', 'developer', 'product_owner', 'project_manager', 'qa'];

    expect(orderRoles(fromServer.map((id) => role(id))).map(({ id }) => id)).toEqual(ROLE_ORDER);
  });

  it('puts a role it does not know after the known ones, by name', () => {
    const ordered = orderRoles([
      role('zebra', 'Zebra keeper'),
      role('qa'),
      role('analyst', 'Data analyst'),
      role('developer'),
    ]);

    expect(ordered.map(({ id }) => id)).toEqual(['developer', 'qa', 'analyst', 'zebra']);
  });

  it('does not change the list it is given', () => {
    const given = [role('qa'), role('developer')];

    orderRoles(given);

    expect(given.map(({ id }) => id)).toEqual(['qa', 'developer']);
  });

  it('gives an empty list for no roles', () => {
    expect(orderRoles([])).toEqual([]);
  });
});
