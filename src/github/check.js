// @ts-check
import { GithubSignInRequiredError } from '../errors/index.js';
import { maskSecrets } from '../logger/index.js';
import { classifyFailure, parseAuthStatus } from './cliStatus.js';
import { CODEOWNERS_LOCATIONS } from './codeowners.js';

// `npm run github:check`: whether this machine, this account and its organisation let the app read
// GitHub with the GitHub CLI's login, checked before switching to gh-cli mode. Everything it uses
// is injected, so the checks are tested without gh, GitHub or an MCP server. It never prints a
// token: only its first four characters.

/** How many characters of a token may be shown: enough to tell gho_ from ghp_. */
export const TOKEN_PREFIX_LENGTH = 4;

/** What to do for each way a GitHub request can fail. */
export const FIXES = Object.freeze({
  'logged-out': 'Log in with `gh auth login`.',
  sso: 'Run `gh auth refresh -h github.com` and authorise your organisation.',
  blocked: 'Your organisation blocks the GitHub CLI — keep GITHUB_AUTH_MODE=token.',
  'not-found': 'Check the repository name in GITHUB_REPOS, and that your account can read it.',
  other: 'GitHub refused the request; try again later.',
});

/** Said when gh cannot be started. */
export const CLI_MISSING = 'GitHub CLI not found — install it or set GITHUB_CLI_PATH.';

/** Said when the MCP server cannot be listed with the CLI token. */
export const MCP_FIX =
  "Your organisation's Copilot or MCP policy may block the GitHub MCP server — keep GITHUB_AUTH_MODE=token.";

const DETAIL_CHARS = 200;
const SSO_HEADER = 'x-github-sso';

/**
 * What a gh command gave back. A non-zero exit is a result, not an error.
 * @typedef {{ code: number, stdout: string, stderr: string }} GhResult
 */

/**
 * The status and message of the last GitHub request that failed, as the app's client saw it.
 * @typedef {{ status: number, ssoHeader?: string | null, message?: string }} FailureDetail
 */

/**
 * What the check works with.
 * @typedef {object} CheckDeps
 * @property {string} cliPath - The gh program, as configured.
 * @property {(args: ReadonlyArray<string>) => Promise<GhResult>} gh - Runs gh; throws only when gh
 *   cannot be started at all.
 * @property {() => Promise<string>} getToken - The GitHub CLI's token.
 * @property {Pick<import('./api.js').GithubApi, 'getJson' | 'getRaw'>} api - The app's own GitHub
 *   client, with the CLI's token.
 * @property {() => FailureDetail | undefined} lastFailure - What the last failed request said.
 * @property {(token: string) => Promise<string[]>} listTools - Lists the GitHub MCP server's tools
 *   with the token and the read-only headers.
 * @property {ReadonlyArray<string>} readTools - The six tools the app allows.
 * @property {(name: string) => boolean} isWriteTool - Whether a tool name means a write.
 * @property {ReadonlyArray<string>} repos - GITHUB_REPOS.
 * @property {ReadonlyArray<string>} shellTokenVariables - GH_TOKEN or GITHUB_TOKEN, when set in the
 *   shell the check was started from.
 */

/**
 * What the check found.
 * @typedef {{ ok: boolean, lines: string[] }} CheckResult
 */

/**
 * Wraps fetch so the check can say why a request failed: the app's client reports only the status,
 * but the fix depends on GitHub's single sign-on header and message too.
 * @param {typeof fetch} fetchFunction - The fetch to wrap.
 * @returns {{ fetch: typeof fetch, lastFailure: () => FailureDetail | undefined }} The wrapped fetch,
 *   and what the last failed response said.
 */
export function recordFailures(fetchFunction) {
  /** @type {FailureDetail | undefined} */
  let last;
  /** @type {typeof fetch} */
  const recording = async (input, init) => {
    const response = await fetchFunction(input, init);
    if (!response.ok) {
      /** @type {unknown} */
      let body;
      try {
        body = await response.clone().json();
      } catch {
        body = undefined;
      }
      const message = /** @type {{ message?: unknown } | undefined} */ (body)?.message;
      last = {
        status: response.status,
        ssoHeader: response.headers.get(SSO_HEADER),
        message: typeof message === 'string' ? message : undefined,
      };
    }
    return response;
  };
  return { fetch: recording, lastFailure: () => last };
}

/**
 * Masks anything shaped like a token, and shortens.
 * @param {string} text - Text from gh or a server.
 * @returns {string} Safe text.
 */
function safe(text) {
  return maskSecrets(text.trim(), [], DETAIL_CHARS);
}

/**
 * Checks gh itself: that it starts, which version, and that it is logged in.
 * @param {CheckDeps} deps - What the check works with.
 * @param {string[]} lines - Where the report goes.
 * @returns {Promise<boolean>} Whether gh is there and logged in.
 */
async function checkLogin({ cliPath, gh, shellTokenVariables }, lines) {
  let version;
  try {
    version = await gh(['--version']);
  } catch {
    lines.push(`FAIL GitHub CLI (${cliPath}): ${CLI_MISSING}`);
    return false;
  }
  lines.push(`gh: ${cliPath} (${safe(version.stdout.split(/\r?\n/)[0])})`);
  const result = await gh(['auth', 'status', '--hostname', 'github.com']);
  const status = parseAuthStatus(`${result.stdout}\n${result.stderr}`);
  if (!status.loggedIn) {
    lines.push(`FAIL login: ${FIXES['logged-out']}`);
    return false;
  }
  lines.push(
    `PASS login: ${status.account} (${status.source}); scopes: ${status.scopes.join(', ') || 'none listed'}`,
  );
  status.attention.forEach((line) => lines.push(`  ${line}`));
  const variables = [
    ...new Set([
      ...shellTokenVariables,
      ...(status.variable === undefined ? [] : [status.variable]),
    ]),
  ];
  if (variables.length > 0) {
    lines.push(
      `WARN ${variables.join(', ')}: the CLI token comes from an environment variable, not your gh login; unset it, or the app may use a different account.`,
    );
  }
  return true;
}

/**
 * Describes a failed request with the fix for it.
 * @param {FailureDetail | undefined} failure - What GitHub said.
 * @returns {string} The status and the fix.
 */
function describeRefusal(failure) {
  if (failure === undefined) {
    return `no answer from GitHub. ${FIXES.other}`;
  }
  return `GitHub answered ${failure.status}. ${FIXES[classifyFailure(failure)]}`;
}

/**
 * Runs one request, giving what went wrong when it fails.
 * @param {CheckDeps} deps - What the check works with.
 * @param {() => Promise<unknown>} request - The request.
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, reason: string }>} The outcome.
 */
async function attempt({ lastFailure }, request) {
  try {
    return { ok: true, value: await request() };
  } catch (error) {
    if (error instanceof GithubSignInRequiredError) {
      return { ok: false, reason: FIXES[error.reason === 'sso' ? 'sso' : 'logged-out'] };
    }
    return { ok: false, reason: describeRefusal(lastFailure()) };
  }
}

/**
 * Checks one repository: a contents read, the head-commit lookup, and the CODEOWNERS lookup.
 * @param {CheckDeps} deps - What the check works with.
 * @param {string} repo - `owner/repo`.
 * @returns {Promise<string>} The report line, starting PASS or FAIL.
 */
async function checkRepo(deps, repo) {
  const { api } = deps;
  const contents = await attempt(deps, () => api.getJson(`/repos/${repo}/contents/`));
  if (!contents.ok) {
    return `FAIL ${repo}: contents read: ${contents.reason}`;
  }
  const info = await attempt(deps, () => api.getJson(`/repos/${repo}`));
  const branch = info.ok
    ? /** @type {Record<string, unknown>} */ (info.value).default_branch
    : undefined;
  const commit =
    typeof branch === 'string'
      ? await attempt(deps, () =>
          api.getJson(`/repos/${repo}/commits/${encodeURIComponent(branch)}`),
        )
      : info;
  if (!commit.ok) {
    return `FAIL ${repo}: commit lookup: ${commit.reason}`;
  }
  let owners = 'no CODEOWNERS file';
  for (const location of CODEOWNERS_LOCATIONS) {
    const found = await attempt(deps, () => api.getRaw(`/repos/${repo}/contents/${location}`));
    if (!found.ok) {
      return `FAIL ${repo}: CODEOWNERS lookup: ${found.reason}`;
    }
    if (found.value !== undefined) {
      owners = `CODEOWNERS in ${location}`;
      break;
    }
  }
  return `PASS ${repo}: contents read, commit lookup, ${owners}`;
}

/**
 * Lists the GitHub MCP server's tools with the CLI token and checks them.
 * @param {CheckDeps} deps - What the check works with.
 * @param {string} token - The CLI token.
 * @returns {Promise<string[]>} The report lines, the first starting PASS or FAIL.
 */
async function checkMcp({ listTools, readTools, isWriteTool }, token) {
  let names;
  try {
    names = await listTools(token);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [`FAIL MCP: ${safe(detail)}. ${MCP_FIX}`];
  }
  const missing = readTools.filter((tool) => !names.includes(tool));
  const writes = names.filter((name) => isWriteTool(name));
  if (missing.length === 0 && writes.length === 0) {
    return [`PASS MCP: all ${readTools.length} read tools found, no write tool offered`];
  }
  return [
    `FAIL MCP: ${[
      ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
      ...(writes.length > 0 ? [`write tools offered: ${writes.join(', ')}`] : []),
    ].join('; ')}. ${MCP_FIX}`,
  ];
}

/**
 * Runs every check and reports each on its own line, then the overall result.
 * @param {CheckDeps} deps - What the check works with.
 * @returns {Promise<CheckResult>} Whether everything passed, and the report.
 */
export async function runGithubCheck(deps) {
  /** @type {string[]} */
  const lines = [];
  const finish = (/** @type {boolean} */ ok) => {
    lines.push(
      ok
        ? 'PASS: switch to GITHUB_AUTH_MODE=gh-cli when you are ready.'
        : 'FAIL: keep GITHUB_AUTH_MODE=token until the failures above are fixed.',
    );
    return { ok, lines };
  };
  if (!(await checkLogin(deps, lines))) {
    return finish(false);
  }
  let token;
  try {
    token = await deps.getToken();
  } catch (error) {
    const reason = error instanceof GithubSignInRequiredError ? error.reason : 'logged-out';
    lines.push(`FAIL token: ${reason === 'cli-missing' ? CLI_MISSING : FIXES['logged-out']}`);
    return finish(false);
  }
  lines.push(`token: ${token.slice(0, TOKEN_PREFIX_LENGTH)}… (only the prefix is shown)`);
  const repoLines = [];
  for (const repo of deps.repos) {
    repoLines.push(await checkRepo(deps, repo));
  }
  const mcpLines = await checkMcp(deps, token);
  lines.push(...repoLines, ...mcpLines);
  return finish([...repoLines, ...mcpLines].every((line) => line.startsWith('PASS')));
}
