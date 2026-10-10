// @ts-check
import { readFileSync } from 'node:fs';

const DISCOVERY_FILE = new URL('../../docs/mcp-tools.md', import.meta.url);
const SERVER_SECTION = /^## /m;
const TOOL_ROW = /^\| `([^`]+)` \| (read|write) \| [^|]* \| ([^|]*) \|/gm;
const ARGUMENT = /`([^`]+)`(\*)?/g;

/**
 * What docs/mcp-tools.md says about one tool.
 * @typedef {object} DiscoveredTool
 * @property {'read' | 'write'} kind - How discovery classified the tool.
 * @property {Map<string, boolean>} args - Argument name to whether it is required.
 */

/**
 * Reads the tools listed in docs/mcp-tools.md, the output of `npm run mcp:tools`.
 * @returns {Map<string, Map<string, DiscoveredTool>>} For each server key, its tools by name.
 */
export function readDiscoveredTools() {
  const servers = new Map();
  for (const section of readFileSync(DISCOVERY_FILE, 'utf8').split(SERVER_SECTION).slice(1)) {
    const key = section.split('\n', 1)[0].trim();
    const tools = new Map();
    for (const [, name, kind, argumentsCell] of section.matchAll(TOOL_ROW)) {
      const args = new Map(
        [...argumentsCell.matchAll(ARGUMENT)].map(([, argument, star]) => [argument, star === '*']),
      );
      tools.set(name, { kind, args });
    }
    servers.set(key, tools);
  }
  return servers;
}
