// @ts-check
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig, loadEnvFileIfPresent } from '../config/index.js';
import { AppError } from '../errors/index.js';
import { buildMcpServers, checkSample, parseSampleArgs, rawSamplePath } from '../mcp/index.js';
import { connectMcp } from './mcpConnect.js';
import { describeError, EXIT_FAILURE } from './shared.js';

const JSON_INDENT = 2;

/**
 * Calls one allow-listed tool and saves its raw result for building fixtures.
 */
async function main() {
  try {
    const request = parseSampleArgs(process.argv.slice(2));
    loadEnvFileIfPresent();
    const config = loadConfig();
    const { server, tool } = checkSample(request, {
      repos: config.github.repos,
      spaceKeys: config.atlassian.spaceKeys,
      siteUrl: config.atlassian.siteUrl,
    });
    const client = await connectMcp(buildMcpServers(config, {})[server]);
    try {
      const result = await client.callTool({ name: tool, arguments: request.args });
      if (result.isError === true) {
        throw new AppError(`${server} / ${tool} returned an error; nothing was saved`);
      }
      const path = rawSamplePath(request.name);
      await mkdir(dirname(path), { recursive: true });
      const sample = { server, tool, arguments: request.args, result };
      await writeFile(path, JSON.stringify(sample, undefined, JSON_INDENT));
      process.stdout.write(`Saved ${server} / ${tool} to ${path}\n`);
    } finally {
      await client.close();
    }
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
