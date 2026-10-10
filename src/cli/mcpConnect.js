// @ts-check
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CLIENT_INFO = { name: 'role-aware-assistant-tools', version: '0.1.0' };

/**
 * Opens a real MCP connection to a remote server. Shared by the discovery and sampling commands
 * and the live tests.
 * @param {import('../mcp/discovery.js').ServerEndpoint} endpoint - Server URL, headers, timeout.
 * @returns {Promise<Client>} A connected client; the caller closes it.
 */
export async function connectMcp({ url, headers, timeout }) {
  const client = new Client(CLIENT_INFO);
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  await client.connect(transport, { timeout });
  return client;
}
