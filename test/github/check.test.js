// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GithubSignInRequiredError } from '../../src/errors/index.js';
import {
  CLI_MISSING,
  FIXES,
  MCP_FIX,
  recordFailures,
  runGithubCheck,
} from '../../src/github/index.js';
import { ALLOWLIST, isWriteToolName, SERVER_KEYS } from '../../src/mcp/index.js';

const FAKE_TOKEN = 'gho_FAKEfakeFAKEfake0123456789abcdefXYZ';
const READ_TOOLS = ALLOWLIST[SERVER_KEYS.github];
const REPO = 'acme/app';
const STATUS = [
  'github.com',
  '  ✓ Logged in to github.com account TsepoG (keyring)',
  `  - Token: ${FAKE_TOKEN}`,
  "  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
].join('\n');

/**
 * An error the way the app's client fails.
 * @param {number} status - The status.
 * @returns {Error} The error.
 */
const answered = (status) => new Error(`GitHub answered ${status}`);

/**
 * Deps for a check where everything passes, with parts replaced.
 * @param {Partial<import('../../src/github/check.js').CheckDeps>} [replace] - Parts to change.
 * @returns {import('../../src/github/check.js').CheckDeps} The deps.
 */
function deps(replace = {}) {
  return {
    cliPath: 'gh',
    gh: vi.fn(async (args) =>
      args[0] === '--version'
        ? {
            code: 0,
            stdout: 'gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli\n',
            stderr: '',
          }
        : { code: 0, stdout: STATUS, stderr: '' },
    ),
    getToken: vi.fn(async () => FAKE_TOKEN),
    api: {
      getJson: vi.fn(async (path) =>
        path === `/repos/${REPO}` ? { default_branch: 'main' } : { sha: 'a'.repeat(40) },
      ),
      getRaw: vi.fn(async () => undefined),
    },
    lastFailure: () => undefined,
    listTools: vi.fn(async () => [...READ_TOOLS, 'search_commits']),
    readTools: READ_TOOLS,
    isWriteTool: isWriteToolName,
    repos: [REPO],
    shellTokenVariables: [],
    ...replace,
  };
}

/**
 * Runs the check and joins its report.
 * @param {import('../../src/github/check.js').CheckDeps} input - The deps.
 * @returns {Promise<{ ok: boolean, text: string, lines: string[] }>} The outcome.
 */
async function check(input) {
  const { ok, lines } = await runGithubCheck(input);
  return { ok, lines, text: lines.join('\n') };
}

describe('runGithubCheck when everything is allowed', () => {
  it('passes every check and says to switch, showing only the token prefix', async () => {
    const input = deps();

    const { ok, lines, text } = await check(input);

    expect(ok).toBe(true);
    expect(lines).toEqual([
      'gh: gh (gh version 2.102.0 (2026-09-30))',
      'PASS login: TsepoG (keyring); scopes: gist, read:org, repo, workflow',
      'token: gho_… (only the prefix is shown)',
      `PASS ${REPO}: contents read, commit lookup, no CODEOWNERS file`,
      'PASS MCP: all 6 read tools found, no write tool offered',
      'PASS: switch to GITHUB_AUTH_MODE=gh-cli when you are ready.',
    ]);
    expect(text).not.toContain(FAKE_TOKEN);
    expect(input.listTools).toHaveBeenCalledWith(FAKE_TOKEN);
  });

  it('reads the default branch head and says where CODEOWNERS was found', async () => {
    const input = deps();
    /** @type {import('vitest').Mock} */ (input.api.getRaw).mockImplementation(async (path) =>
      path.endsWith('/CODEOWNERS') && !path.includes('.github') && !path.includes('docs/')
        ? '* @acme/team'
        : undefined,
    );

    const { text } = await check(input);

    expect(text).toContain(`PASS ${REPO}: contents read, commit lookup, CODEOWNERS in CODEOWNERS`);
    expect(input.api.getJson).toHaveBeenCalledWith(`/repos/${REPO}/commits/main`);
    expect(input.api.getJson).toHaveBeenCalledWith(`/repos/${REPO}/contents/`);
  });
});

describe('runGithubCheck on gh itself', () => {
  it('fails when gh cannot be started, naming the program', async () => {
    const { ok, lines } = await check(
      deps({
        cliPath: 'C:\\Tools\\gh.exe',
        gh: vi.fn(async () => {
          throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        }),
      }),
    );

    expect(ok).toBe(false);
    expect(lines[0]).toBe(`FAIL GitHub CLI (C:\\Tools\\gh.exe): ${CLI_MISSING}`);
  });

  it('fails when gh is not logged in, and says to log in', async () => {
    const { ok, text } = await check(
      deps({
        gh: vi.fn(async (args) =>
          args[0] === '--version'
            ? { code: 0, stdout: 'gh version 2.102.0', stderr: '' }
            : { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts.' },
        ),
      }),
    );

    expect(ok).toBe(false);
    expect(text).toContain(`FAIL login: ${FIXES['logged-out']}`);
    expect(text).toContain('FAIL: keep GITHUB_AUTH_MODE=token');
  });

  it('warns when the token comes from an environment variable, from the shell or from gh', async () => {
    const fromShell = await check(deps({ shellTokenVariables: ['GH_TOKEN'] }));
    const fromGh = await check(
      deps({
        gh: vi.fn(async () => ({
          code: 0,
          stdout: STATUS.replace('(keyring)', '(GITHUB_TOKEN)'),
          stderr: '',
        })),
      }),
    );

    expect(fromShell.text).toContain(
      'WARN GH_TOKEN: the CLI token comes from an environment variable, not your gh login; unset it, or the app may use a different account.',
    );
    expect(fromGh.text).toContain('WARN GITHUB_TOKEN:');
    expect(fromShell.ok).toBe(true);
  });

  it('says when gh lists no scopes', async () => {
    const { text } = await check(
      deps({
        gh: vi.fn(async () => ({
          code: 0,
          stdout: 'github.com\n  ✓ Logged in to github.com account TsepoG (keyring)\n',
          stderr: '',
        })),
      }),
    );

    expect(text).toContain('PASS login: TsepoG (keyring); scopes: none listed');
  });

  it('shows the single sign-on lines gh prints, masked', async () => {
    const { text } = await check(
      deps({
        gh: vi.fn(async () => ({
          code: 0,
          stdout: `${STATUS}\n  ! Organization acme requires SAML SSO authorization for token ${FAKE_TOKEN}`,
          stderr: '',
        })),
      }),
    );

    expect(text).toContain('Organization acme requires SAML SSO authorization');
    expect(text).not.toContain(FAKE_TOKEN);
  });

  it.each([
    [new GithubSignInRequiredError('cli-missing'), CLI_MISSING],
    [new GithubSignInRequiredError('logged-out'), FIXES['logged-out']],
    [new Error('odd'), FIXES['logged-out']],
  ])('fails when the token cannot be read (%s)', async (failure, fix) => {
    const { ok, text } = await check(
      deps({
        getToken: vi.fn(async () => {
          throw failure;
        }),
      }),
    );

    expect(ok).toBe(false);
    expect(text).toContain(`FAIL token: ${fix}`);
  });
});

describe('runGithubCheck on a repository', () => {
  it.each([
    [{ status: 401 }, FIXES['logged-out']],
    [{ status: 403, ssoHeader: 'required; url=https://github.com/orgs/acme/sso' }, FIXES.sso],
    [
      { status: 403, message: 'the `acme` organization has enabled OAuth App access restrictions' },
      FIXES.blocked,
    ],
    [{ status: 404, message: 'Not Found' }, FIXES['not-found']],
    [{ status: 500 }, FIXES.other],
  ])('fails the contents read with the fix for %j', async (failure, fix) => {
    const input = deps({ lastFailure: () => failure });
    /** @type {import('vitest').Mock} */ (input.api.getJson).mockRejectedValue(
      answered(failure.status),
    );

    const { ok, text } = await check(input);

    expect(ok).toBe(false);
    expect(text).toContain(
      `FAIL ${REPO}: contents read: GitHub answered ${failure.status}. ${fix}`,
    );
  });

  it('says when GitHub gave no answer at all', async () => {
    const input = deps();
    /** @type {import('vitest').Mock} */ (input.api.getJson).mockRejectedValue(
      new TypeError('fetch failed'),
    );

    expect((await check(input)).text).toContain(
      `contents read: no answer from GitHub. ${FIXES.other}`,
    );
  });

  it.each([
    [new GithubSignInRequiredError('sso'), FIXES.sso],
    [new GithubSignInRequiredError('logged-out'), FIXES['logged-out']],
  ])('passes on a sign-in error from the client as its fix (%s)', async (failure, fix) => {
    const input = deps();
    /** @type {import('vitest').Mock} */ (input.api.getJson).mockRejectedValue(failure);

    expect((await check(input)).text).toContain(`contents read: ${fix}`);
  });

  it('fails the commit lookup when the repository cannot be read', async () => {
    const input = deps({ lastFailure: () => ({ status: 404 }) });
    /** @type {import('vitest').Mock} */ (input.api.getJson).mockImplementation(async (path) => {
      if (path.endsWith('/contents/')) {
        return {};
      }
      throw answered(404);
    });

    expect((await check(input)).text).toContain(
      `FAIL ${REPO}: commit lookup: GitHub answered 404.`,
    );
  });

  it('fails the commit lookup when the head commit cannot be read', async () => {
    const input = deps({ lastFailure: () => ({ status: 401 }) });
    /** @type {import('vitest').Mock} */ (input.api.getJson).mockImplementation(async (path) => {
      if (path.includes('/commits/')) {
        throw answered(401);
      }
      return path === `/repos/${REPO}` ? { default_branch: 'main' } : {};
    });

    expect((await check(input)).text).toContain(
      `FAIL ${REPO}: commit lookup: GitHub answered 401. ${FIXES['logged-out']}`,
    );
  });

  it('passes a repository without a default branch through to the CODEOWNERS lookup', async () => {
    const input = deps();
    /** @type {import('vitest').Mock} */ (input.api.getJson).mockResolvedValue({});

    expect((await check(input)).text).toContain(`PASS ${REPO}:`);
  });

  it('fails the CODEOWNERS lookup when it is refused', async () => {
    const input = deps({ lastFailure: () => ({ status: 403 }) });
    /** @type {import('vitest').Mock} */ (input.api.getRaw).mockRejectedValue(answered(403));

    expect((await check(input)).text).toContain(
      `FAIL ${REPO}: CODEOWNERS lookup: GitHub answered 403. ${FIXES.other}`,
    );
  });
});

describe('runGithubCheck on the MCP server', () => {
  it('fails when a read tool is missing or a write tool is offered', async () => {
    const { ok, text } = await check(
      deps({ listTools: vi.fn(async () => [...READ_TOOLS.slice(1), 'create_or_update_file']) }),
    );

    expect(ok).toBe(false);
    expect(text).toContain(
      `FAIL MCP: missing search_code; write tools offered: create_or_update_file. ${MCP_FIX}`,
    );
  });

  it('fails only on the write tool when every read tool is there', async () => {
    const { text } = await check(
      deps({ listTools: vi.fn(async () => [...READ_TOOLS, 'merge_pull_request']) }),
    );

    expect(text).toContain(`FAIL MCP: write tools offered: merge_pull_request. ${MCP_FIX}`);
  });

  it('fails only on the missing tool when no write tool is offered', async () => {
    const { text } = await check(deps({ listTools: vi.fn(async () => READ_TOOLS.slice(1)) }));

    expect(text).toContain(`FAIL MCP: missing search_code. ${MCP_FIX}`);
  });

  it('fails when the server cannot be listed, without repeating a token', async () => {
    const failing = await check(
      deps({
        listTools: vi.fn(async () => {
          throw new Error(`401 for Bearer ${FAKE_TOKEN}`);
        }),
      }),
    );
    const odd = await check(
      deps({
        listTools: vi.fn(async () => {
          throw 'refused';
        }),
      }),
    );

    expect(failing.ok).toBe(false);
    expect(failing.text).toContain(`FAIL MCP: 401 for ***. ${MCP_FIX}`);
    expect(failing.text).not.toContain(FAKE_TOKEN);
    expect(odd.text).toContain('FAIL MCP: refused.');
  });

  it('gives the reason under a wrapped error, and ends each sentence once', async () => {
    const { text } = await check(
      deps({
        listTools: vi.fn(async () => {
          throw new Error('Could not list the tools of the "github_repos" MCP server.', {
            cause: new Error('HTTP 403: SAML enforcement.'),
          });
        }),
      }),
    );

    expect(text).toContain(
      `FAIL MCP: Could not list the tools of the "github_repos" MCP server: HTTP 403: SAML enforcement. ${MCP_FIX}`,
    );
    expect(text).not.toContain('..');
  });
});

describe('recordFailures', () => {
  it('records the status, the single sign-on header and the message of a failed response', async () => {
    const recorder = recordFailures(
      vi.fn(
        async () =>
          new Response('{"message":"SAML enforcement"}', {
            status: 403,
            headers: { 'X-GitHub-SSO': 'required' },
          }),
      ),
    );

    const response = await recorder.fetch('https://api.github.com/x');

    expect(recorder.lastFailure()).toEqual({
      status: 403,
      ssoHeader: 'required',
      message: 'SAML enforcement',
    });
    expect(await response.json()).toEqual({ message: 'SAML enforcement' });
  });

  it('records no message when the body is not JSON or has none', async () => {
    const text = recordFailures(vi.fn(async () => new Response('nope', { status: 500 })));
    const empty = recordFailures(vi.fn(async () => new Response('{}', { status: 404 })));

    await text.fetch('https://api.github.com/x');
    await empty.fetch('https://api.github.com/x');

    expect(text.lastFailure()).toEqual({ status: 500, ssoHeader: null, message: undefined });
    expect(empty.lastFailure()?.message).toBeUndefined();
  });

  it('records nothing for a success', async () => {
    const recorder = recordFailures(vi.fn(async () => new Response('{}')));

    await recorder.fetch('https://api.github.com/x');

    expect(recorder.lastFailure()).toBeUndefined();
  });
});
