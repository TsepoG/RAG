// @ts-check
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, loadEnvFileIfPresent } from '../../src/config/index.js';
import { ALLOWLIST, buildMcpServers, collectToolReport } from '../../src/mcp/index.js';
import { connectMcp } from '../../src/mcp/index.js';

const LIVE_TIMEOUT_MS = 60_000;

/** @type {Awaited<ReturnType<typeof collectToolReport>>} */
let report;

beforeAll(async () => {
  loadEnvFileIfPresent();
  report = await collectToolReport(buildMcpServers(loadConfig(), {}), connectMcp);
}, LIVE_TIMEOUT_MS);

/**
 * Finds a tool in what a live server listed.
 * @param {string} server - Server key.
 * @param {string} tool - Bare tool name.
 * @returns {import('../../src/mcp/discovery.js').ReportedTool | undefined} The tool, if listed.
 */
function listed(server, tool) {
  return report.find(({ key }) => key === server)?.tools.find(({ name }) => name === tool);
}

const allowListed = Object.entries(ALLOWLIST).flatMap(([server, tools]) =>
  tools.map((tool) => ({ server, tool })),
);

describe('live MCP discovery', () => {
  it.each(allowListed)('$server still offers the allow-listed tool $tool', ({ server, tool }) => {
    expect(listed(server, tool)).toBeDefined();
  });

  it.each(allowListed)(
    '$server tool $tool is still classified as read-only',
    ({ server, tool }) => {
      expect(listed(server, tool)?.kind).toBe('read');
    },
  );
});
