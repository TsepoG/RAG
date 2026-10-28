// @ts-check
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CLIENT_INFO = Object.freeze({ name: 'role-aware-assistant', version: '0.1.0' });

/**
 * Builds the MCP client and its HTTP transport. Replaced in tests, so no test opens a connection.
 * @typedef {object} McpFactories
 * @property {() => Client} createClient - Makes the client.
 * @property {(url: URL, requestInit: RequestInit) => StreamableHTTPClientTransport} createTransport - Makes the transport.
 */

/** @type {McpFactories} */
export const MCP_FACTORIES = Object.freeze({
  createClient: () => new Client({ ...CLIENT_INFO }),
  createTransport: (url, requestInit) => new StreamableHTTPClientTransport(url, { requestInit }),
});

/**
 * Opens a real MCP connection to a remote server: for the app's own calls (the site check after
 * signing in, and re-checks in oauth mode), the discovery and sampling commands, and the live tests.
 * None of these go through Copilot.
 * @param {import('./discovery.js').ServerEndpoint} endpoint - Server URL, headers, timeout.
 * @param {McpFactories} [factories] - How the client and transport are made.
 * @returns {Promise<Client>} A connected client; the caller closes it.
 */
export async function connectMcp({ url, headers, timeout }, factories = MCP_FACTORIES) {
  const client = factories.createClient();
  const transport = factories.createTransport(new URL(url), { headers });
  await client.connect(transport, { timeout });
  return client;
}
