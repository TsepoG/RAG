// @ts-check
import { SERVER_KEYS } from './servers.js';

// Reviewed by hand against docs/mcp-tools.md (run `npm run mcp:tools` to refresh it). A tool is
// here only if it reads, is needed to answer a question, and can be scoped to GITHUB_REPOS or
// CONFLUENCE_SPACE_KEYS by the pre-tool hook. Adding one is a security decision: re-check the file.
//
// Atlassian is Confluence-only. Left out on purpose:
// - search: Rovo search spans Jira and third-party content and cannot be limited to a space.
// - executeRead, discover: generic gateways to ~319 operations across every Atlassian product,
//   so allowing them would bypass this list. executeWrite and executeDestructive likewise.
// - getGraphContext, getGraphObject: Teamwork Graph reads across products.
// - getJiraIssue, searchJiraIssuesUsingJql: Jira is out of scope.
// - getLoomVideo, atlassianUserInfo: not needed to answer a question.
// - every create/update/edit/add/transition tool.
const ATLASSIAN_TOOLS = Object.freeze([
  'searchConfluence',
  'getConfluenceContent',
  'getAccessibleAtlassianResources',
]);

// GitHub, repo-scoped tools only. Left out on purpose: search_repositories, search_commits and
// list_repository_collaborators (not limited to GITHUB_REPOS, or expose people), and
// list_branches, list_tags, get_tag, get_release_by_tag (not needed to answer a question).
const GITHUB_TOOLS = Object.freeze([
  'search_code',
  'get_file_contents',
  'get_commit',
  'list_commits',
  'list_releases',
  'get_latest_release',
]);

/**
 * The read-only tools each MCP server may expose to Copilot, by server key and bare tool name.
 * Used for the `tools` field of each server, the pre-tool hook and the permission handler.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ALLOWLIST = Object.freeze({
  [SERVER_KEYS.atlassian]: ATLASSIAN_TOOLS,
  [SERVER_KEYS.github]: GITHUB_TOOLS,
});

/**
 * Separates the server key from the tool name in the runtime's tool names.
 * @type {string}
 */
export const QUALIFIED_NAME_SEPARATOR = '-';

/**
 * Prefix of a tool filter that targets MCP tools, as `availableTools` expects.
 * @type {string}
 */
export const MCP_FILTER_PREFIX = 'mcp:';

/**
 * Whether a tool is on a server's allow-list.
 * @param {string} server - Server key, for example `github_repos`.
 * @param {string} tool - Bare tool name, for example `get_file_contents`.
 * @returns {boolean} True only for an exact, listed tool of a known server.
 */
export function isAllowedTool(server, tool) {
  return Object.hasOwn(ALLOWLIST, server) && ALLOWLIST[server].includes(tool);
}

/**
 * Builds the name the Copilot runtime gives an MCP tool.
 * @param {string} server - Server key.
 * @param {string} tool - Bare tool name.
 * @returns {string} `<server>-<tool>`.
 */
export function qualifiedName(server, tool) {
  return `${server}${QUALIFIED_NAME_SEPARATOR}${tool}`;
}

/**
 * Splits a runtime tool name back into server key and bare tool name.
 * @param {string} name - A name such as `github_repos-get_file_contents`.
 * @returns {{ server: string, tool: string } | undefined} The parts, or undefined when the name
 *   does not start with a known server key.
 */
export function parseQualifiedName(name) {
  const server = Object.keys(ALLOWLIST).find((key) =>
    name.startsWith(`${key}${QUALIFIED_NAME_SEPARATOR}`),
  );
  if (server === undefined) {
    return undefined;
  }
  return { server, tool: name.slice(server.length + QUALIFIED_NAME_SEPARATOR.length) };
}

/**
 * Builds the `availableTools` filter that exposes exactly the allow-listed MCP tools.
 * @returns {string[]} Entries such as `mcp:atlassian-searchConfluence`, one per allowed tool.
 */
export function toAvailableTools() {
  return Object.entries(ALLOWLIST).flatMap(([server, tools]) =>
    tools.map((tool) => `${MCP_FILTER_PREFIX}${qualifiedName(server, tool)}`),
  );
}
