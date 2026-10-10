// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  isAllowedTool,
  MCP_FILTER_PREFIX,
  parseQualifiedName,
  qualifiedName,
  toAvailableTools,
} from '../../src/mcp/allowlist.js';
import { classifyTool, isWriteToolName } from '../../src/mcp/classify.js';
import { SERVER_KEYS } from '../../src/mcp/servers.js';

const DISCOVERY_FILE = new URL('../../docs/mcp-tools.md', import.meta.url);

/**
 * Reads the tools listed in docs/mcp-tools.md.
 * @returns {Map<string, Map<string, string>>} For each server key, tool name to its class.
 */
function discoveredTools() {
  const servers = new Map();
  for (const section of readFileSync(DISCOVERY_FILE, 'utf8').split(/^## /m).slice(1)) {
    const key = section.split('\n', 1)[0].trim();
    const tools = new Map();
    for (const [, name, kind] of section.matchAll(/^\| `([^`]+)` \| (read|write) \|/gm)) {
      tools.set(name, kind);
    }
    servers.set(key, tools);
  }
  return servers;
}

describe('ALLOWLIST contents', () => {
  it('allows exactly three Confluence tools on Atlassian', () => {
    expect(ALLOWLIST[SERVER_KEYS.atlassian]).toEqual([
      'searchConfluence',
      'getConfluenceContent',
      'getAccessibleAtlassianResources',
    ]);
  });

  it('allows exactly six repo-scoped tools on GitHub', () => {
    expect(ALLOWLIST[SERVER_KEYS.github]).toEqual([
      'search_code',
      'get_file_contents',
      'get_commit',
      'list_commits',
      'list_releases',
      'get_latest_release',
    ]);
  });

  it('covers only the two configured servers', () => {
    expect(Object.keys(ALLOWLIST).sort()).toEqual(['atlassian', 'github_repos']);
  });

  it('is frozen, along with every list in it', () => {
    expect(Object.isFrozen(ALLOWLIST)).toBe(true);
    expect(Object.values(ALLOWLIST).every((tools) => Object.isFrozen(tools))).toBe(true);
  });

  it('lists no tool twice', () => {
    for (const tools of Object.values(ALLOWLIST)) {
      expect(new Set(tools).size).toBe(tools.length);
    }
  });
});

describe('ALLOWLIST is read-only', () => {
  const allListed = Object.entries(ALLOWLIST).flatMap(([server, tools]) =>
    tools.map((tool) => ({ server, tool })),
  );

  it.each(allListed)('classifies $server $tool as read', ({ tool }) => {
    expect(classifyTool({ name: tool }).kind).toBe('read');
    expect(isWriteToolName(tool)).toBe(false);
  });

  it.each(allListed)('has no Jira tool: $tool', ({ tool }) => {
    expect(tool.toLowerCase()).not.toContain('jira');
  });
});

describe('ALLOWLIST matches docs/mcp-tools.md', () => {
  const discovered = discoveredTools();

  it('found both servers in the discovery output', () => {
    expect([...discovered.keys()]).toEqual(['atlassian', 'github_repos']);
  });

  it.each(
    Object.entries(ALLOWLIST).flatMap(([server, tools]) => tools.map((tool) => [server, tool])),
  )('lists %s tool %s as read', (server, tool) => {
    expect(discovered.get(server)?.get(tool)).toBe('read');
  });
});

describe('tools that must never be allowed', () => {
  it.each(['executeRead', 'executeWrite', 'executeDestructive', 'discover'])(
    'does not allow the generic gateway %s on any server',
    (tool) => {
      expect(isAllowedTool(SERVER_KEYS.atlassian, tool)).toBe(false);
      expect(isAllowedTool(SERVER_KEYS.github, tool)).toBe(false);
    },
  );

  it('keeps executeRead and discover out even though the classifier calls them read', () => {
    expect(classifyTool({ name: 'executeRead' }).kind).toBe('read');
    expect(classifyTool({ name: 'discover' }).kind).toBe('read');
    expect(isAllowedTool(SERVER_KEYS.atlassian, 'executeRead')).toBe(false);
    expect(isAllowedTool(SERVER_KEYS.atlassian, 'discover')).toBe(false);
  });

  it.each([
    'search',
    'getGraphContext',
    'getGraphObject',
    'getJiraIssue',
    'searchJiraIssuesUsingJql',
    'getLoomVideo',
    'atlassianUserInfo',
    'createConfluenceContent',
    'updateConfluenceContent',
    'createJiraIssue',
    'transitionJiraIssue',
  ])('does not allow the excluded Atlassian tool %s', (tool) => {
    expect(isAllowedTool(SERVER_KEYS.atlassian, tool)).toBe(false);
  });

  it.each([
    'search_repositories',
    'search_commits',
    'list_repository_collaborators',
    'list_branches',
    'list_tags',
    'get_tag',
    'get_release_by_tag',
    'create_or_update_file',
    'push_files',
  ])('does not allow the excluded GitHub tool %s', (tool) => {
    expect(isAllowedTool(SERVER_KEYS.github, tool)).toBe(false);
  });
});

describe('isAllowedTool', () => {
  it('allows a listed tool on its own server', () => {
    expect(isAllowedTool('github_repos', 'get_file_contents')).toBe(true);
    expect(isAllowedTool('atlassian', 'searchConfluence')).toBe(true);
  });

  it('does not allow a listed tool on the other server', () => {
    expect(isAllowedTool('atlassian', 'get_file_contents')).toBe(false);
    expect(isAllowedTool('github_repos', 'searchConfluence')).toBe(false);
  });

  it('does not allow an unknown tool', () => {
    expect(isAllowedTool('github_repos', 'made_up_tool')).toBe(false);
  });

  it('is exact: no case folding and no partial names', () => {
    expect(isAllowedTool('github_repos', 'GET_FILE_CONTENTS')).toBe(false);
    expect(isAllowedTool('github_repos', 'get_file')).toBe(false);
    expect(isAllowedTool('github_repos', 'get_file_contents ')).toBe(false);
  });

  it.each(['unknown', 'toString', '__proto__', 'constructor', ''])(
    'does not allow anything on the server %j',
    (server) => {
      expect(isAllowedTool(server, 'search_code')).toBe(false);
    },
  );
});

describe('qualifiedName and parseQualifiedName', () => {
  it('joins server and tool the way the runtime does', () => {
    expect(qualifiedName('github_repos', 'get_file_contents')).toBe(
      'github_repos-get_file_contents',
    );
  });

  it.each(Object.entries(ALLOWLIST).flatMap(([s, tools]) => tools.map((t) => [s, t])))(
    'round-trips %s %s',
    (server, tool) => {
      expect(parseQualifiedName(qualifiedName(server, tool))).toEqual({ server, tool });
    },
  );

  it('keeps hyphens that are part of the tool name', () => {
    expect(parseQualifiedName('atlassian-some-tool')).toEqual({
      server: 'atlassian',
      tool: 'some-tool',
    });
  });

  it.each(['search_code', 'github-search_code', 'unknown-search_code', 'atlassian', ''])(
    'returns undefined for %j',
    (name) => {
      expect(parseQualifiedName(name)).toBeUndefined();
    },
  );
});

describe('toAvailableTools', () => {
  it('builds one mcp: filter per allowed tool', () => {
    const filters = toAvailableTools();

    expect(filters).toHaveLength(9);
    expect(filters).toContain('mcp:atlassian-searchConfluence');
    expect(filters).toContain('mcp:github_repos-search_code');
  });

  it('contains only exact mcp: names, never a wildcard', () => {
    for (const filter of toAvailableTools()) {
      expect(filter.startsWith(MCP_FILTER_PREFIX)).toBe(true);
      expect(filter).not.toContain('*');
    }
  });

  it('returns a new array each time', () => {
    expect(toAvailableTools()).not.toBe(toAvailableTools());
  });
});
