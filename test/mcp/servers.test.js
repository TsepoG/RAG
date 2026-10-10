// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import {
  ATLASSIAN_MCP_URL,
  buildMcpServers,
  GITHUB_MCP_URL,
  SERVER_KEYS,
} from '../../src/mcp/servers.js';
import {
  FAKE_ATLASSIAN_TOKEN,
  FAKE_COPILOT_TOKEN,
  FAKE_GITHUB_TOKEN,
  validEnv,
} from '../helpers/env.js';

const TOOL_NAMES = {
  [SERVER_KEYS.atlassian]: ['search', 'getConfluenceContent'],
  [SERVER_KEYS.github]: ['get_file_contents', 'search_code'],
};

/**
 * Builds the servers from a fixture config.
 * @param {Record<string, string | undefined>} [overrides] - Environment overrides.
 * @param {Record<string, ReadonlyArray<string>>} [toolNames] - Tools to expose.
 * @returns {ReturnType<typeof buildMcpServers>} The server entries.
 */
function build(overrides = {}, toolNames = TOOL_NAMES) {
  return buildMcpServers(loadConfig(validEnv(overrides)), toolNames);
}

describe('buildMcpServers', () => {
  it('registers exactly the Atlassian and GitHub servers under their keys', () => {
    expect(Object.keys(build())).toEqual(['atlassian', 'github_repos']);
    expect(SERVER_KEYS).toEqual({ atlassian: 'atlassian', github: 'github_repos' });
  });

  it('points each entry at its remote server over http', () => {
    const servers = build();

    expect(servers.atlassian).toMatchObject({ type: 'http', url: ATLASSIAN_MCP_URL });
    expect(servers.github_repos).toMatchObject({ type: 'http', url: GITHUB_MCP_URL });
    expect(ATLASSIAN_MCP_URL).toBe('https://mcp.atlassian.com/v2/mcp');
    expect(GITHUB_MCP_URL).toBe('https://api.githubcopilot.com/mcp/');
  });

  it('sends the Atlassian credentials as Basic auth over email:apiToken', () => {
    const header = build().atlassian.headers?.Authorization ?? '';

    expect(header.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(header.slice('Basic '.length), 'base64').toString()).toBe(
      `dev@acme.example:${FAKE_ATLASSIAN_TOKEN}`,
    );
  });

  it('sends the GitHub token as a Bearer token and asks for read-only repos tools', () => {
    expect(build().github_repos.headers).toEqual({
      Authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
      'X-MCP-Readonly': 'true',
      'X-MCP-Toolsets': 'repos',
    });
  });

  it('exposes exactly the tools it is given for each server', () => {
    const servers = build();

    expect(servers.atlassian.tools).toEqual(['search', 'getConfluenceContent']);
    expect(servers.github_repos.tools).toEqual(['get_file_contents', 'search_code']);
  });

  it('exposes no tools for a server it has no tool names for', () => {
    const onlyAtlassian = build({}, { [SERVER_KEYS.atlassian]: ['search'] });
    const onlyGithub = build({}, { [SERVER_KEYS.github]: ['get_file_contents'] });

    expect(onlyAtlassian.github_repos.tools).toEqual([]);
    expect(onlyGithub.atlassian.tools).toEqual([]);
  });

  it('copies the tool lists so changing the result cannot change the allow-list', () => {
    const source = ['search'];
    const servers = build({}, { ...TOOL_NAMES, [SERVER_KEYS.atlassian]: source });

    servers.atlassian.tools?.push('createConfluencePage');

    expect(source).toEqual(['search']);
  });

  it('takes the per-call timeout from config', () => {
    const servers = build({ MCP_TIMEOUT_MS: '45000' });

    expect(servers.atlassian.timeout).toBe(45_000);
    expect(servers.github_repos.timeout).toBe(45_000);
  });

  it('defaults the per-call timeout to 30 seconds', () => {
    expect(build().atlassian.timeout).toBe(30_000);
  });

  it('never puts the Copilot credential in a header', () => {
    const servers = build({ COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN });

    expect(JSON.stringify(servers)).not.toContain(FAKE_COPILOT_TOKEN);
  });
});
