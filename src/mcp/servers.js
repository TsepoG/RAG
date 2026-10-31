// @ts-check
import { encodeBasicCredentials } from '../config/index.js';
import { AtlassianSignInRequiredError, GithubSignInRequiredError } from '../errors/index.js';

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
 * What a caller may add to the server entries.
 * @typedef {object} McpServerOptions
 * @property {string} [atlassianToken] - The signed-in person's access token; needed in oauth mode,
 *   unused otherwise.
 * @property {string} [githubToken] - The GitHub CLI's token; needed in gh-cli mode, unused in token
 *   mode.
 */

/**
 * Builds the Authorization header for Atlassian. A personal API token is sent as Basic
 * `email:token`; a service-account API key, or the token of a person who signed in, is sent as a
 * Bearer token on its own.
 * @param {import('../config/index.js').AppConfig['atlassian']} atlassian - Atlassian settings.
 * @param {string | undefined} atlassianToken - The signed-in access token, in oauth mode.
 * @returns {string} The header value.
 * @throws {AtlassianSignInRequiredError} In oauth mode, when there is no token.
 */
function atlassianAuthorization({ auth, apiToken }, atlassianToken) {
  if (auth.mode === 'oauth') {
    if (atlassianToken === undefined) {
      throw new AtlassianSignInRequiredError();
    }
    return `Bearer ${atlassianToken}`;
  }
  // The config always has an API token in basic and bearer modes.
  const token = /** @type {string} */ (apiToken);
  return auth.mode === 'bearer'
    ? `Bearer ${token}`
    : `Basic ${encodeBasicCredentials(auth.email, token)}`;
}

/**
 * Builds the Authorization header for GitHub: the personal access token in token mode, the GitHub
 * CLI's token in gh-cli mode. Both are sent as a Bearer token.
 * @param {import('../config/index.js').AppConfig['github']} github - GitHub settings.
 * @param {string | undefined} githubToken - The CLI's token, in gh-cli mode.
 * @returns {string} The header value.
 * @throws {GithubSignInRequiredError} In gh-cli mode, when there is no token.
 */
function githubAuthorization({ mode, token }, githubToken) {
  if (mode === 'gh-cli') {
    if (githubToken === undefined) {
      throw new GithubSignInRequiredError('logged-out');
    }
    return `Bearer ${githubToken}`;
  }
  return `Bearer ${token}`;
}

/**
 * Builds the GitHub entry on its own: the same entry `buildMcpServers` makes, for the app's own MCP
 * calls that need only GitHub (`npm run github:check`), so they do not need an Atlassian sign-in.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @param {ReadonlyArray<string>} tools - Read-only tools to expose.
 * @param {string | undefined} githubToken - The CLI's token, in gh-cli mode.
 * @returns {import('@github/copilot-sdk').MCPHTTPServerConfig} The entry.
 * @throws {GithubSignInRequiredError} In gh-cli mode, when no token is given.
 */
export function buildGithubMcpServer(config, tools, githubToken) {
  return {
    type: HTTP_SERVER_TYPE,
    url: GITHUB_MCP_URL,
    headers: {
      Authorization: githubAuthorization(config.github, githubToken),
      ...GITHUB_READONLY_HEADERS,
    },
    tools: [...tools],
    timeout: config.mcp.timeoutMs,
  };
}

/**
 * Builds the `mcpServers` entries for a Copilot session: Atlassian (Confluence) and GitHub.
 * The result holds credentials in its headers, so it must only ever be logged through the logger.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @param {ServerToolNames} toolNames - Read-only tools to expose, keyed by server key.
 * @param {McpServerOptions} [options] - The signed-in token in oauth mode, the CLI's token in gh-cli mode.
 * @returns {Record<string, import('@github/copilot-sdk').MCPHTTPServerConfig>} Entries by key.
 * @throws {AtlassianSignInRequiredError} In oauth mode, when no token is given.
 * @throws {GithubSignInRequiredError} In gh-cli mode, when no token is given.
 */
export function buildMcpServers(config, toolNames, { atlassianToken, githubToken } = {}) {
  const { timeoutMs } = config.mcp;
  return {
    [SERVER_KEYS.atlassian]: {
      type: HTTP_SERVER_TYPE,
      url: ATLASSIAN_MCP_URL,
      headers: {
        Authorization: atlassianAuthorization(config.atlassian, atlassianToken),
      },
      tools: [...(toolNames[SERVER_KEYS.atlassian] ?? [])],
      timeout: timeoutMs,
    },
    [SERVER_KEYS.github]: buildGithubMcpServer(
      config,
      toolNames[SERVER_KEYS.github] ?? [],
      githubToken,
    ),
  };
}
