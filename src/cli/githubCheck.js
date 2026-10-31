// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildGithubCliEnv, githubCliPath, githubTokenVariables } from '../config/index.js';
import { AppError } from '../errors/index.js';
import {
  createCliTokenProvider,
  createGithubApi,
  GH_TIMEOUT_MS,
  recordFailures,
  runGithubCheck,
} from '../github/index.js';
import {
  ALLOWLIST,
  buildMcpServers,
  connectMcp,
  isWriteToolName,
  listServerTools,
  SERVER_KEYS,
} from '../mcp/index.js';
import { describeError, EXIT_FAILURE, loadSettings } from './shared.js';

// Wiring only: `npm run github:check`. The checks themselves are in src/github/check.js.

const run = promisify(execFile);

/**
 * Runs gh as the app does: no shell, a time limit, and without the variables that replace its
 * login. A non-zero exit is returned with its output; only a gh that cannot start throws.
 * @param {string} cliPath - The gh program.
 * @param {Record<string, string>} env - The environment.
 * @returns {(args: ReadonlyArray<string>) => Promise<{ code: number, stdout: string, stderr: string }>} The runner.
 */
function ghRunner(cliPath, env) {
  return async (args) => {
    try {
      const { stdout, stderr } = await run(cliPath, args, {
        env,
        timeout: GH_TIMEOUT_MS,
        windowsHide: true,
        shell: false,
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = /** @type {{ code?: unknown, stdout?: string, stderr?: string }} */ (error);
      if (typeof failed.code !== 'number') {
        throw error;
      }
      return { code: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  };
}

/**
 * Checks, before switching to gh-cli mode, that the GitHub CLI's login can read every repository
 * in GITHUB_REPOS and the GitHub MCP server. Works in either mode.
 */
async function main() {
  // Read before .env is loaded, so a GITHUB_TOKEN from .env is not mistaken for the shell's.
  const shellTokenVariables = githubTokenVariables();
  try {
    const settings = loadSettings();
    const { config, logger } = settings;
    const cliPath = config.github.cliPath ?? githubCliPath();
    const env = buildGithubCliEnv();
    const provider = createCliTokenProvider({ cliPath, env, logger });
    const recorder = recordFailures((...args) => fetch(...args));
    // The CLI's token whatever the mode, so the check answers for gh-cli mode before switching.
    const ghCliConfig = {
      ...config,
      github: { ...config.github, mode: /** @type {const} */ ('gh-cli') },
    };
    const { ok, lines } = await runGithubCheck({
      cliPath,
      gh: ghRunner(cliPath, env),
      getToken: () => provider.getGithubToken(),
      api: createGithubApi({ getToken: () => provider.getGithubToken(), fetch: recorder.fetch }),
      lastFailure: recorder.lastFailure,
      listTools: async (token) => {
        const endpoint = buildMcpServers(ghCliConfig, {}, { githubToken: token })[
          SERVER_KEYS.github
        ];
        const tools = await listServerTools(SERVER_KEYS.github, endpoint, connectMcp);
        return tools.map(({ name }) => name);
      },
      readTools: ALLOWLIST[SERVER_KEYS.github],
      isWriteTool: isWriteToolName,
      repos: config.github.repos,
      shellTokenVariables,
    });
    lines.forEach((line) => process.stdout.write(`${line}\n`));
    process.exitCode = ok ? 0 : EXIT_FAILURE;
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
