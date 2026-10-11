// @ts-check

/**
 * Registers `GET /api/health` and `GET /api/roles`.
 * @param {import('fastify').FastifyInstance} app - The app.
 * @param {{ roles: ReadonlyMap<string, import('../../roles/index.js').Role> }} deps - The loaded roles.
 */
export function registerInfoRoutes(app, { roles }) {
  const summaries = [...roles.values()].map(({ id, displayName, description, depth }) => ({
    id,
    displayName,
    description,
    depth,
  }));
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/roles', async () => summaries);
}
