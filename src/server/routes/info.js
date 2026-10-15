// @ts-check

/**
 * What the page needs to know about a role. `suggestedQuestions` is left out when the role has none.
 * @param {import('../../roles/index.js').Role} role - A loaded role.
 * @returns {{ id: string, displayName: string, description: string, depth: number, suggestedQuestions?: string[] }} The summary.
 */
function summarise({ id, displayName, description, depth, suggestedQuestions }) {
  const summary = { id, displayName, description, depth };
  return suggestedQuestions === undefined || suggestedQuestions.length === 0
    ? summary
    : { ...summary, suggestedQuestions: [...suggestedQuestions] };
}

/**
 * Registers `GET /api/health` and `GET /api/roles`.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {{ roles: ReadonlyMap<string, import('../../roles/index.js').Role> }} deps - The loaded roles.
 */
export function registerInfoRoutes(app, { roles }) {
  const summaries = [...roles.values()].map(summarise);
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/roles', async () => summaries);
}
