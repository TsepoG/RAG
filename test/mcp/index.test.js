// @ts-check
import { describe, expect, it } from 'vitest';
import * as mcp from '../../src/mcp/index.js';

describe('mcp public entry point', () => {
  it('exports the server builder, server keys, URLs, classifier and discovery', () => {
    expect(Object.keys(mcp).sort()).toEqual([
      'ALLOWLIST',
      'ATLASSIAN_MCP_URL',
      'GITHUB_MCP_URL',
      'RAW_DIRECTORY',
      'SERVER_KEYS',
      'TOOLS_LOCKED_REASON',
      'buildMcpServers',
      'checkSample',
      'classifyTool',
      'collectToolReport',
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
