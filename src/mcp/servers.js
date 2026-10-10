// @ts-check
import { encodeBasicCredentials } from '../config/index.js';

/**
 * The tool names each MCP server exposes to Copilot, keyed by server key.
 * @typedef {Readonly<Record<string, ReadonlyArray<string>>>} ServerToolNames
 */

/**
 * Keys the two servers are registered under. The runtime names a tool `<key>-<tool>`, and these
 * keys are chosen so they cannot clash with the runtime's own built-in GitHub MCP server.
 */
export const SERVER_KEYS = Object.freeze({
  atlassian: 'atlassian',
  github: 'github_repos',
});

/** Remote Atlassian Rovo MCP server. */
export const ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v2/mcp';

/** Remote GitHub MCP server. */
export const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

const HTTP_SERVER_TYPE = 'http';
const GITHUB_READONLY_HEADERS = Object.freeze({
  'X-MCP-Readonly': 'true',
  'X-MCP-Toolsets': 'repos',
});

/**
 * Builds the Authorization header for Atlassian. A personal API token is sent as Basic
 * `email:token`; a service-account API key is sent as a Bearer token on its own.
 * @param {import('../config/index.js').AppConfig['atlassian']} atlassian - Atlassian settings.
 * @returns {string} The header value.
 */
function atlassianAuthorization({ auth, apiToken }) {
  return auth.mode === 'bearer'
    ? `Bearer ${apiToken}`
    : `Basic ${encodeBasicCredentials(auth.email, apiToken)}`;
}

/**
 * Builds the `mcpServers` entries for a Copilot session: Atlassian (Confluence) and GitHub.
 * The result holds credentials in its headers, so it must only ever be logged through the logger.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @param {ServerToolNames} toolNames - Read-only tools to expose, keyed by server key.
 * @returns {Record<string, import('@github/copilot-sdk').MCPHTTPServerConfig>} Entries by key.
 */
export function buildMcpServers(config, toolNames) {
  const { timeoutMs } = config.mcp;
  return {
    [SERVER_KEYS.atlassian]: {
      type: HTTP_SERVER_TYPE,
      url: ATLASSIAN_MCP_URL,
      headers: {
        Authorization: atlassianAuthorization(config.atlassian),
      },
      tools: [...(toolNames[SERVER_KEYS.atlassian] ?? [])],
      timeout: timeoutMs,
    },
    [SERVER_KEYS.github]: {
      type: HTTP_SERVER_TYPE,
      url: GITHUB_MCP_URL,
      headers: {
        Authorization: `Bearer ${config.github.token}`,
        ...GITHUB_READONLY_HEADERS,
      },
      tools: [...(toolNames[SERVER_KEYS.github] ?? [])],
      timeout: timeoutMs,
    },
  };
}
