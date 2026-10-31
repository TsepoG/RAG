// @ts-check
import { describe, expect, it } from 'vitest';
import * as mcp from '../../src/mcp/index.js';

describe('mcp public entry point', () => {
  it('exports the server builder, server keys, URLs, classifier and discovery', () => {
    expect(Object.keys(mcp).sort()).toEqual([
      'ALLOWLIST',
      'ATLASSIAN_MCP_URL',
      'GITHUB_MCP_URL',
      'MCP_FACTORIES',
      'RAW_DIRECTORY',
      'SERVER_KEYS',
      'TOOLS_LOCKED_REASON',
      'buildGithubMcpServer',
      'buildMcpServers',
      'checkSample',
      'classifyTool',
      'collectToolReport',
      'connectMcp',
      'createCallBudget',
      'createPermissionHandler',
      'createToolGate',
      'createToolHooks',
      'createTurnGate',
      'isAllowedTool',
      'isWriteToolName',
      'listServerTools',
      'parseQualifiedName',
      'parseSampleArgs',
      'qualifiedName',
      'rawSamplePath',
      'renderToolsMarkdown',
      'resolveTool',
      'toAvailableTools',
    ]);
  });
});
