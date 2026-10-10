// @ts-check
import { describe, expect, it } from 'vitest';
import * as mcp from '../../src/mcp/index.js';

describe('mcp public entry point', () => {
  it('exports the server builder, server keys, URLs, classifier and discovery', () => {
    expect(Object.keys(mcp).sort()).toEqual([
      'ALLOWLIST',
      'ATLASSIAN_MCP_URL',
      'GITHUB_MCP_URL',
      'SERVER_KEYS',
      'buildMcpServers',
      'classifyTool',
      'collectToolReport',
      'isAllowedTool',
      'isWriteToolName',
      'listServerTools',
      'parseQualifiedName',
      'qualifiedName',
      'renderToolsMarkdown',
      'toAvailableTools',
    ]);
  });
});
