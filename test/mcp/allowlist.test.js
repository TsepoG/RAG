// @ts-check
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  isAllowedTool,
  MCP_FILTER_PREFIX,
  parseQualifiedName,
  qualifiedName,
  resolveTool,
  toAvailableTools,
} from '../../src/mcp/allowlist.js';
import { classifyTool, isWriteToolName } from '../../src/mcp/classify.js';
import { SERVER_KEYS } from '../../src/mcp/servers.js';
import { readDiscoveredTools } from '../helpers/discovery-doc.js';

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
  const discovered = readDiscoveredTools();

  it('found both servers in the discovery output', () => {
    expect([...discovered.keys()]).toEqual(['atlassian', 'github_repos']);
  });

  it.each(
    Object.entries(ALLOWLIST).flatMap(([server, tools]) => tools.map((tool) => [server, tool])),
  )('lists %s tool %s as read', (server, tool) => {
    expect(discovered.get(server)?.get(tool)?.kind).toBe('read');
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

describe('resolveTool', () => {
  it.each(Object.entries(ALLOWLIST).flatMap(([s2, tools]) => tools.map((t) => [s2, t])))(
    'resolves the qualified name of %s %s',
    (server, tool) => {
      expect(resolveTool(qualifiedName(server, tool))).toEqual({ server, tool });
    },
  );

  it.each(Object.entries(ALLOWLIST).flatMap(([s2, tools]) => tools.map((t) => [s2, t])))(
    'resolves the bare name of %s %s when only one server lists it',
    (server, tool) => {
      expect(resolveTool(tool)).toEqual({ server, tool });
    },
  );

  it('still resolves a qualified name whose tool is not allowed, so the caller can refuse it', () => {
    expect(resolveTool('github_repos-push_files')).toEqual({
      server: 'github_repos',
      tool: 'push_files',
    });
  });

  it.each(['push_files', 'bash', 'view', 'executeRead', '', 'rogue-search_code'])(
    'does not resolve %j',
    (name) => {
      expect(resolveTool(name)).toBeUndefined();
    },
  );
});
