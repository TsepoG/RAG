// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logger/index.js';
import { createPermissionHandler, REJECTION_FEEDBACK } from '../../src/mcp/permissions.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const INVOCATION = { sessionId: 'session-1' };
const REJECTED = { kind: 'reject', feedback: REJECTION_FEEDBACK };

/**
 * Builds a handler wired to an in-memory logger.
 * @param {import('../../src/mcp/permissions.js').IsAllowed} [isAllowed] - Allow-list override.
 * @returns {{ handler: import('@github/copilot-sdk').PermissionHandler, lines: () => Array<Record<string, unknown>> }}
 *   The handler and a reader for what it logged.
 */
function setup(isAllowed) {
  const { stream, lines } = createMemoryStream();
  const logger = createLogger({ level: 'debug', destination: stream });
  return { handler: createPermissionHandler({ logger, isAllowed }), lines };
}

/**
 * Builds a permission request.
 * @param {Record<string, unknown>} fields - Fields of the request, including its kind.
 * @returns {import('@github/copilot-sdk').PermissionRequest} The request.
 */
function request(fields) {
  // Deliberately loose: tests send partial, odd and future-kind requests the real type forbids.
  return /** @type {import('@github/copilot-sdk').PermissionRequest} */ (
    /** @type {unknown} */ (fields)
  );
}

describe('createPermissionHandler approvals', () => {
  it('approves an allow-listed MCP tool, once', () => {
    const { handler } = setup();

    const result = handler(
      request({ kind: 'mcp', serverName: 'github_repos', toolName: 'get_file_contents' }),
      INVOCATION,
    );

    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('asks the allow-list about the exact server and tool', () => {
    const isAllowed = vi.fn(() => true);
    const { handler } = setup(isAllowed);

    handler(
      request({ kind: 'mcp', serverName: 'atlassian', toolName: 'searchConfluence' }),
      INVOCATION,
    );

    expect(isAllowed).toHaveBeenCalledExactlyOnceWith('atlassian', 'searchConfluence');
  });

  it('logs nothing for an approved request', () => {
    const { handler, lines } = setup();

    handler(
      request({ kind: 'mcp', serverName: 'atlassian', toolName: 'searchConfluence' }),
      INVOCATION,
    );

    expect(lines()).toEqual([]);
  });
});

describe('createPermissionHandler rejects every other kind of request', () => {
  const kinds = [
    'shell',
    'write',
    'read',
    'url',
    'memory',
    'custom-tool',
    'hook',
    'extension-management',
    'workflow',
    'extension-permission-access',
    'extension-env-access',
    'a-kind-added-by-a-future-sdk',
  ];

  it.each(kinds)('rejects %s even when its tool name is on the allow-list', (kind) => {
    const isAllowed = vi.fn(() => true);
    const { handler } = setup(isAllowed);

    const result = handler(
      request({ kind, serverName: 'github_repos', toolName: 'get_file_contents' }),
      INVOCATION,
    );

    expect(result).toEqual(REJECTED);
    expect(isAllowed).not.toHaveBeenCalled();
  });

  it.each(kinds)('logs the rejected %s request at warn with only its kind', (kind) => {
    const { handler, lines } = setup();

    handler(
      request({ kind, fullCommandText: 'rm -rf secret-dir', fileName: '/etc/secret' }),
      INVOCATION,
    );

    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'warn',
        msg: 'permission request rejected',
        reason: 'not-mcp',
        kind,
      }),
    ]);
    const logged = JSON.stringify(lines());
    expect(logged).not.toContain('secret-dir');
    expect(logged).not.toContain('/etc/secret');
  });

  it('rejects a request with no kind at all', () => {
    const { handler } = setup();

    expect(handler(request({}), INVOCATION)).toEqual(REJECTED);
  });
});

describe('createPermissionHandler rejects MCP calls that are not allowed', () => {
  it.each([
    ['an MCP tool that is not on the allow-list', 'github_repos', 'create_or_update_file'],
    ['a write tool of the Atlassian server', 'atlassian', 'createConfluenceContent'],
    [
      'an allowed tool name that arrives from an unknown server',
      'rogue-server',
      'get_file_contents',
    ],
  ])('rejects %s', (_description, serverName, toolName) => {
    const { handler } = setup();

    const result = handler(request({ kind: 'mcp', serverName, toolName }), INVOCATION);

    expect(result).toEqual(REJECTED);
  });

  it('rejects an allow-listed tool when managed policy demands a human decision', () => {
    const isAllowed = vi.fn(() => true);
    const { handler, lines } = setup(isAllowed);

    const result = handler(
      request({
        kind: 'mcp',
        serverName: 'atlassian',
        toolName: 'searchConfluence',
        managedApprovalRequired: true,
      }),
      INVOCATION,
    );

    expect(result).toEqual(REJECTED);
    expect(isAllowed).not.toHaveBeenCalled();
    expect(lines()[0]).toMatchObject({ reason: 'managed-approval-required' });
  });

  it('logs the server and tool of a rejected MCP call, but never its arguments', () => {
    const { handler, lines } = setup();

    handler(
      request({
        kind: 'mcp',
        serverName: 'github_repos',
        toolName: 'create_or_update_file',
        args: { content: 'TOP-SECRET-BODY', token: 'ghp_not_logged' },
      }),
      INVOCATION,
    );

    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'warn',
        reason: 'not-allow-listed',
        kind: 'mcp',
        server: 'github_repos',
        tool: 'create_or_update_file',
      }),
    ]);
    const logged = JSON.stringify(lines());
    expect(logged).not.toContain('TOP-SECRET-BODY');
    expect(logged).not.toContain('ghp_not_logged');
  });

  it('tells the model only that the action is not permitted', () => {
    expect(REJECTION_FEEDBACK).toBe(
      'This action is not permitted. Only read-only Confluence and GitHub search tools are available.',
    );
  });
});

describe('createPermissionHandler fails closed', () => {
  it('rejects, and logs at error, when the allow-list check throws', () => {
    const failure = new Error('allow-list exploded');
    const { handler, lines } = setup(() => {
      throw failure;
    });

    const result = handler(
      request({ kind: 'mcp', serverName: 'atlassian', toolName: 'searchConfluence' }),
      INVOCATION,
    );

    expect(result).toEqual(REJECTED);
    expect(lines()).toEqual([
      expect.objectContaining({
        level: 'error',
        msg: 'permission handler failed; rejecting',
        err: expect.objectContaining({ message: 'allow-list exploded' }),
      }),
    ]);
  });

  it('rejects when the request cannot be read', () => {
    const { handler } = setup();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('cannot read request');
        },
      },
    );

    expect(handler(request(hostile), INVOCATION)).toEqual(REJECTED);
  });

  it('never returns an approval for any request when the check throws', () => {
    const { handler } = setup(() => {
      throw new Error('boom');
    });
    const kinds = ['mcp', 'shell', 'write', 'read', 'url'];

    const results = kinds.map((kind) => handler(request({ kind }), INVOCATION));

    // The handler answers synchronously, though its declared type also allows a promise.
    const decisions = results.map((result) => /** @type {{ kind: string }} */ (result).kind);
    expect(decisions).toEqual(kinds.map(() => 'reject'));
  });
});
