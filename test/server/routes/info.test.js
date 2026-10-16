// @ts-check
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerInfoRoutes } from '../../../src/server/routes/info.js';
import { makeRole } from '../../helpers/role.js';

/**
 * Lists the roles through the route, as the page would.
 * @param {Array<import('../../../src/roles/index.js').Role>} list - The loaded roles.
 * @returns {Promise<unknown>} What the route sends.
 */
async function rolesFrom(list) {
  const app = Fastify();
  registerInfoRoutes(app, { roles: new Map(list.map((role) => [role.id, role])) });
  const response = await app.inject({ url: '/api/roles' });
  return response.json();
}

describe('GET /api/roles suggested questions', () => {
  it('sends the suggested questions of a role that has them', async () => {
    const role = makeRole({ suggestedQuestions: ['What does it do today?', 'Who owns it?'] });

    expect(await rolesFrom([role])).toEqual([
      {
        id: 'tester',
        displayName: 'Tester',
        description: 'A role for tests.',
        depth: 2,
        suggestedQuestions: ['What does it do today?', 'Who owns it?'],
      },
    ]);
  });

  it('leaves the field out for a role with none, or with an empty list', async () => {
    const none = makeRole({ id: 'a' });
    const empty = makeRole({ id: 'b', suggestedQuestions: [] });

    const sent = /** @type {Array<Record<string, unknown>>} */ (await rolesFrom([none, empty]));

    expect(sent.map((role) => 'suggestedQuestions' in role)).toEqual([false, false]);
  });

  it('never sends anything else a role holds, such as its prompt', async () => {
    const sent = /** @type {Array<Record<string, unknown>>} */ (await rolesFrom([makeRole()]));

    expect(Object.keys(sent[0]).sort()).toEqual(['depth', 'description', 'displayName', 'id']);
  });
});
