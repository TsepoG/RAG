// @ts-check
import { z } from 'zod';
import { AtlassianAuthError } from '../errors/index.js';
import { describeFailure, postJson } from './http.js';

/** The name Atlassian shows on its consent page. */
export const CLIENT_NAME = 'Role-Aware Knowledge Assistant';

/** The one address the sign-in comes back to; see the HOST rule in the config. */
const CALLBACK_HOST = '127.0.0.1';

/** The path Atlassian sends the browser back to after signing in. */
export const CALLBACK_PATH = '/auth/atlassian/callback';

const registrationSchema = z.object({ client_id: z.string().min(1) });

/**
 * The redirect address registered with Atlassian for the port the app listens on.
 * @param {number} port - The app's port.
 * @returns {string} `http://127.0.0.1:<port>/auth/atlassian/callback`.
 */
export function redirectUriFor(port) {
  return `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;
}

/**
 * Returns the app's registration with Atlassian, registering it first when there is none, or the
 * stored one was made for another authorization server or another port. The app registers as a
 * public client: it has no secret, and PKCE protects each sign-in instead.
 * @param {object} deps - What it needs.
 * @param {import('./store.js').SignInStore} deps.store - Where the registration is kept.
 * @param {import('./discovery.js').AuthorizationServer} deps.server - The authorization server.
 * @param {string} deps.redirectUri - Where the sign-in comes back to.
 * @param {typeof fetch} deps.fetch - The fetch to use.
 * @param {Pick<import('../logger/index.js').Logger, 'info'>} deps.logger - Where a registration is logged.
 * @returns {Promise<import('./store.js').StoredClient>} The registration.
 * @throws {AtlassianAuthError} When Atlassian refuses the registration or it cannot be saved.
 */
export async function ensureClient({ store, server, redirectUri, fetch, logger }) {
  const stored = await store.readClient();
  if (stored?.issuer === server.issuer && stored.redirectUri === redirectUri) {
    return stored;
  }
  const what = 'register the assistant with Atlassian';
  const result = await postJson(
    fetch,
    server.registrationEndpoint,
    {
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    what,
  );
  const parsed = registrationSchema.safeParse(result.body);
  if (!result.ok || !parsed.success) {
    throw new AtlassianAuthError('failed', describeFailure(what, result));
  }
  const client = { issuer: server.issuer, clientId: parsed.data.client_id, redirectUri };
  await store.writeClient(client);
  logger.info({}, 'registered the assistant with Atlassian');
  return client;
}
