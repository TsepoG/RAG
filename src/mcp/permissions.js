// @ts-check
import { isAllowedTool } from './allowlist.js';

/**
 * Decides whether a tool may run.
 * @typedef {(server: string, tool: string) => boolean} IsAllowed
 */

/**
 * Dependencies of the permission handler, injected so tests need no real allow-list or logger.
 * @typedef {object} PermissionHandlerDeps
 * @property {Pick<import('../logger/index.js').Logger, 'warn' | 'error'>} logger - Where
 *   rejections are logged.
 * @property {IsAllowed} [isAllowed] - The allow-list check; defaults to the real allow-list.
 */

/** The only kind of request that can ever be approved: a call to an MCP tool. */
const MCP_REQUEST_KIND = 'mcp';

/** Sent back to the model with every rejection. It is generic so it reveals nothing about why. */
export const REJECTION_FEEDBACK =
  'This action is not permitted. Only read-only Confluence and GitHub search tools are available.';

/**
 * Why a request was rejected, for the log.
 * @typedef {'not-mcp' | 'managed-approval-required' | 'not-allow-listed' | 'error'} RejectionReason
 */

/**
 * Builds a rejection result.
 * @returns {import('@github/copilot-sdk').PermissionRequestResult} A reject decision with feedback.
 */
function reject() {
  return { kind: 'reject', feedback: REJECTION_FEEDBACK };
}

/**
 * Creates the handler that answers every permission request from the Copilot runtime.
 * Deny by default: only a call to an allow-listed MCP tool is approved. Shell, file, URL, memory,
 * custom-tool, hook and every other kind (including kinds added by future SDK versions) is
 * rejected. Any failure inside the handler rejects too.
 * @param {PermissionHandlerDeps} deps - Logger and allow-list check.
 * @returns {import('@github/copilot-sdk').PermissionHandler} The handler to register on a session.
 */
export function createPermissionHandler({ logger, isAllowed = isAllowedTool }) {
  /**
   * Logs a rejection. Only the kind and, for MCP calls, the server and tool name are recorded:
   * never arguments, commands or file contents.
   * @param {RejectionReason} reason - Why the request was rejected.
   * @param {{ kind: string, serverName?: string, toolName?: string }} request - The request.
   */
  function logRejection(reason, { kind, serverName, toolName }) {
    const details =
      kind === MCP_REQUEST_KIND
        ? { reason, kind, server: serverName, tool: toolName }
        : { reason, kind };
    logger.warn(details, 'permission request rejected');
  }

  return (request) => {
    try {
      if (request.kind !== MCP_REQUEST_KIND) {
        logRejection('not-mcp', request);
        return reject();
      }
      if (request.managedApprovalRequired === true) {
        logRejection('managed-approval-required', request);
        return reject();
      }
      if (!isAllowed(request.serverName, request.toolName)) {
        logRejection('not-allow-listed', request);
        return reject();
      }
      return { kind: 'approve-once' };
    } catch (error) {
      // Whatever went wrong, the answer is no: a broken check must never approve a tool. The request
      // is not touched here, because reading it may be what failed.
      logger.error({ err: error }, 'permission handler failed; rejecting');
      return reject();
    }
  };
}
