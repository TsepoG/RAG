// @ts-check
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CLIENT_INFO = { name: 'role-aware-assistant-live-test', version: '0.1.0' };

/**
 * Opens a real MCP connection to a remote server, for the live tests.
 * @param {import('../../src/mcp/discovery.js').ServerEndpoint} endpoint - Server URL, headers, timeout.
 * @returns {Promise<Client>} A connected client.
 */
export async function connectMcp({ url, headers, timeout }) {
  const client = new Client(CLIENT_INFO);
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  await client.connect(transport, { timeout });
  return client;
}
