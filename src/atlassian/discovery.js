// @ts-check
import { z } from 'zod';
import { AtlassianAuthError } from '../errors/index.js';
import { ATLASSIAN_MCP_URL } from '../mcp/index.js';
import { getJson } from './http.js';
import { CHALLENGE_METHOD } from './pkce.js';

// Atlassian's sign-in endpoints are read from its published metadata, never written into the code:
// first the MCP server's protected-resource metadata (RFC 9728), which names the authorization
// server, then that server's own metadata (RFC 8414).

const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
const HTTPS = 'https:';

/**
 * Whether a value is an https URL.
 * @param {string} value - The value.
 * @returns {boolean} True for a URL that parses and uses https.
 */
function isHttpsUrl(value) {
  return URL.canParse(value) && new URL(value).protocol === HTTPS;
}

const httpsUrl = z.string().refine(isHttpsUrl, 'must be an https URL');

const protectedResourceSchema = z.object({
  resource: z.string(),
  authorization_servers: z.array(httpsUrl).min(1, 'must name an authorization server'),
});

const authorizationServerSchema = z.object({
  issuer: httpsUrl,
  authorization_endpoint: httpsUrl,
  token_endpoint: httpsUrl,
  revocation_endpoint: httpsUrl,
  registration_endpoint: httpsUrl,
  code_challenge_methods_supported: z
    .array(z.string())
    .refine((methods) => methods.includes(CHALLENGE_METHOD), `must include ${CHALLENGE_METHOD}`),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
});

/**
 * What the app needs to know about Atlassian's authorization server.
 * @typedef {object} AuthorizationServer
 * @property {string} issuer - The server's identifier.
 * @property {string} authorizationEndpoint - Where the browser is sent to sign in.
 * @property {string} tokenEndpoint - Where a code or a refresh token is exchanged.
 * @property {string} revocationEndpoint - Where tokens are revoked on sign-out.
 * @property {string} registrationEndpoint - Where the app registers itself as a client.
 * @property {boolean} issParameterSupported - Whether the callback carries an `iss` to check.
 */

/**
 * Builds a well-known metadata address for a URL: the well-known path goes between the origin and
 * the URL's own path.
 * @param {string} url - The resource or issuer.
 * @param {string} wellKnownPath - The well-known path.
 * @returns {string} The metadata address.
 */
function wellKnownUrl(url, wellKnownPath) {
  const { origin, pathname } = new URL(url);
  let path = pathname;
  while (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${origin}${wellKnownPath}${path}`;
}

/**
 * Where the MCP server publishes which authorization server it trusts.
 * @param {string} resource - The MCP server's URL.
 * @returns {string} The protected-resource metadata address.
 */
export function protectedResourceMetadataUrl(resource) {
  return wellKnownUrl(resource, PROTECTED_RESOURCE_PATH);
}

/**
 * Where an authorization server publishes its endpoints.
 * @param {string} issuer - The authorization server's identifier.
 * @returns {string} The authorization server metadata address.
 */
export function authorizationServerMetadataUrl(issuer) {
  return wellKnownUrl(issuer, AUTHORIZATION_SERVER_PATH);
}

/**
 * Builds the error for metadata that cannot be used. It names the fields at fault, never their
 * values.
 * @param {string} document - Which document it was.
 * @param {ReadonlyArray<string>} problems - What was wrong.
 * @returns {AtlassianAuthError} The error.
 */
function unusable(document, problems) {
  return new AtlassianAuthError(
    'failed',
    `Atlassian's ${document} cannot be used: ${problems.join('; ')}`,
  );
}

/**
 * Lists a Zod error's problems by field, without the values.
 * @param {import('zod').ZodError} error - The error.
 * @returns {string[]} One `field: rule` entry per issue.
 */
function problemsOf(error) {
  return error.issues.map(({ path, message }) => `${path.join('.') || 'body'}: ${message}`);
}

/**
 * Reads the MCP server's protected-resource metadata.
 * @param {unknown} body - The parsed JSON.
 * @param {string} expectedResource - The MCP server's URL, which the metadata must describe.
 * @returns {string} The authorization server it names first.
 * @throws {AtlassianAuthError} When the metadata is not usable or describes another resource.
 */
export function parseProtectedResource(body, expectedResource) {
  const result = protectedResourceSchema.safeParse(body);
  if (!result.success) {
    throw unusable('MCP server metadata', problemsOf(result.error));
  }
  if (result.data.resource !== expectedResource) {
    throw unusable('MCP server metadata', ['resource: is not the MCP server the app uses']);
  }
  return result.data.authorization_servers[0];
}

/**
 * Reads an authorization server's metadata.
 * @param {unknown} body - The parsed JSON.
 * @param {string} expectedIssuer - The server the metadata was asked for; it must name itself so.
 * @returns {AuthorizationServer} Its endpoints.
 * @throws {AtlassianAuthError} When the metadata is not usable or names another issuer.
 */
export function parseAuthorizationServer(body, expectedIssuer) {
  const result = authorizationServerSchema.safeParse(body);
  if (!result.success) {
    throw unusable('sign-in server metadata', problemsOf(result.error));
  }
  const metadata = result.data;
  if (metadata.issuer !== expectedIssuer) {
    throw unusable('sign-in server metadata', ['issuer: is not the server that was asked']);
  }
  return {
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: metadata.revocation_endpoint,
    registrationEndpoint: metadata.registration_endpoint,
    issParameterSupported: metadata.authorization_response_iss_parameter_supported === true,
  };
}

/**
 * Finds Atlassian's authorization server and its endpoints.
 * @typedef {object} Discovery
 * @property {() => Promise<AuthorizationServer>} authorizationServer - The server, read once per process.
 */

/**
 * Creates the discovery: the MCP server's metadata names the authorization server, whose own
 * metadata lists its endpoints. Both are read the first time they are needed and kept for the life
 * of the process; a failure is not kept, so the next call tries again.
 * @param {{ fetch?: typeof fetch, resource?: string }} [deps] - The fetch to use, and the MCP server.
 * @returns {Discovery} The discovery.
 */
export function createDiscovery({
  fetch: fetchFunction = globalThis.fetch,
  resource = ATLASSIAN_MCP_URL,
} = {}) {
  /** @type {Promise<AuthorizationServer> | undefined} */
  let cached;

  /**
   * Reads both documents.
   * @returns {Promise<AuthorizationServer>} The server.
   */
  async function load() {
    const issuer = parseProtectedResource(
      await getJson(
        fetchFunction,
        protectedResourceMetadataUrl(resource),
        'read the MCP server metadata',
      ),
      resource,
    );
    return parseAuthorizationServer(
      await getJson(
        fetchFunction,
        authorizationServerMetadataUrl(issuer),
        'read the sign-in server metadata',
      ),
      issuer,
    );
  }

  return {
    authorizationServer() {
      cached ??= load().catch((error) => {
        cached = undefined;
        throw error;
      });
      return cached;
    },
  };
}
