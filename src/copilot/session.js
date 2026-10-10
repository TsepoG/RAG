// @ts-check
import { ALLOWLIST, buildMcpServers, toAvailableTools } from '../mcp/index.js';
import { buildSystemMessage } from './systemMessage.js';

/** @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig */

/**
 * Everything a session needs that is built elsewhere.
 * @typedef {object} SessionParts
 * @property {import('../config/index.js').AppConfig} config - Validated config.
 * @property {import('../roles/index.js').Role} role - The role the answer is written for.
 * @property {string} workingDirectory - An empty directory the session runs in.
 * @property {import('@github/copilot-sdk').SessionHooks} hooks - The tool hooks for this question.
 * @property {import('@github/copilot-sdk').PermissionHandler} onPermissionRequest - Answers
 *   every permission request.
 */

/** Names the application in the User-Agent of requests made for the session. */
export const CLIENT_NAME = 'role-aware-assistant';

/**
 * Tool filters that remove everything except MCP tools. Exclusions always win over the
 * available-tools list, so this holds even if a future SDK adds built-in tools to it.
 */
export const EXCLUDED_TOOLS = Object.freeze(['builtin:*', 'custom:*']);

/**
 * Builds the configuration for one Copilot session. Pure: it only assembles values. The session can
 * use the nine allow-listed MCP tools and nothing else; the permission handler and hooks check
 * each call again.
 * @param {SessionParts} parts - Config, working directory, hooks and permission handler.
 * @returns {SessionConfig} The session configuration.
 */
export function buildSessionConfig({ config, role, workingDirectory, hooks, onPermissionRequest }) {
  const { model } = config.copilot;
  return {
    clientName: CLIENT_NAME,
    // Left out when unset, so the SDK or account default applies.
    ...(model === undefined ? {} : { model }),
    streaming: true,
    systemMessage: {
      mode: 'append',
      content: buildSystemMessage({
        role,
        spaceKeys: config.atlassian.spaceKeys,
        repos: config.github.repos,
        siteUrl: config.atlassian.siteUrl,
        cloudId: config.atlassian.cloudId,
      }),
    },
    mcpServers: buildMcpServers(config, ALLOWLIST),
    availableTools: toAvailableTools(),
    excludedTools: [...EXCLUDED_TOOLS],
    workingDirectory,
    // One question per session, so there is nothing to compact, remember or resume.
    infiniteSessions: { enabled: false },
    memory: { enabled: false },
    // Left on, the runtime writes any result over 50 KB to a temp file and gives the model a short
    // pointer instead. The model has no file tool, so a long page would be unreadable, and the
    // hooks could not wrap or check it. Off, the hooks see the whole result and cap it themselves.
    largeOutput: { enabled: false },
    // "empty" mode already defaults these off; stating them keeps the intent visible and tested.
    enableConfigDiscovery: false,
    enableSkills: false,
    enableFileHooks: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    hooks,
    onPermissionRequest,
  };
}
