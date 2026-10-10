// @ts-check
import { writeFile } from 'node:fs/promises';
import { loadConfig, loadEnvFileIfPresent } from '../config/index.js';
import { AppError, ConfigError } from '../errors/index.js';
import { buildMcpServers, collectToolReport, renderToolsMarkdown } from '../mcp/index.js';
import { connectMcp } from './mcpConnect.js';

const OUTPUT_FILE = 'docs/mcp-tools.md';
const FAILURE_EXIT_CODE = 1;

/**
 * Lists both servers' tools and writes docs/mcp-tools.md.
 */
async function main() {
  loadEnvFileIfPresent();
  try {
    const config = loadConfig();
    process.stdout.write(`Atlassian auth: ${config.atlassian.auth.mode}
`);
    const servers = buildMcpServers(config, {});
    const report = await collectToolReport(servers, connectMcp);
    await writeFile(OUTPUT_FILE, renderToolsMarkdown(report, new Date().toISOString()));
    report.forEach(({ key, tools }) => process.stdout.write(`${key}: ${tools.length} tools\n`));
    process.stdout.write(`Wrote ${OUTPUT_FILE}\n`);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    // A ConfigError already lists every problem; its cause would only repeat them as raw JSON.
    const { cause } = error;
    const detail =
      !(error instanceof ConfigError) && cause instanceof Error
        ? `\n  caused by: ${cause.message}`
        : '';
    process.stderr.write(`${error.message}${detail}\n`);
    process.exitCode = FAILURE_EXIT_CODE;
  }
}

await main();
