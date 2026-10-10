// @ts-check

/**
 * Hints an MCP server may attach to a tool.
 * @typedef {{ readOnlyHint?: boolean, destructiveHint?: boolean }} ToolAnnotations
 */

/**
 * What the classifier needs to know about a tool.
 * @typedef {{ name: string, annotations?: ToolAnnotations }} ClassifiableTool
 */

/**
 * Whether a tool may change anything, and why we think so.
 * @typedef {{ kind: 'read' | 'write', reason: string }} ToolClassification
 */

/**
 * Verbs that mean a tool changes something. Matched against every word of a tool name, so
 * `issue_write` and `create_or_update_file` are caught as well as `createPage`.
 * @type {ReadonlyArray<string>}
 */
export const WRITE_VERBS = Object.freeze([
  // Atlassian
  'create',
  'update',
  'delete',
  'add',
  'remove',
  'replace',
  'set',
  'move',
  'copy',
  'archive',
  'unarchive',
  'restore',
  'convert',
  'enable',
  'disable',
  'complete',
  'reopen',
  'star',
  'unstar',
  'watch',
  'unwatch',
  'edit',
  // GitHub
  'push',
  'merge',
  'fork',
  'assign',
  'run',
  'rerun',
  'cancel',
  'dismiss',
  'mark',
  'submit',
  'manage',
  'upload',
  'lock',
  'unlock',
  'approve',
  'close',
  'transfer',
  'resolve',
  // Anything else that obviously writes
  'write',
  'post',
  'publish',
  'send',
  'invite',
  'revoke',
  'grant',
  'deploy',
  'trigger',
  'dispatch',
  'rename',
  'comment',
  'reply',
  'sync',
  'import',
  'apply',
]);

/**
 * Verbs that only mean a write at the start of a name: "request" is the verb in
 * `request_copilot_review` but a noun in the read tool `get_pull_request`.
 * @type {ReadonlyArray<string>}
 */
export const LEADING_ONLY_WRITE_VERBS = Object.freeze(['request']);

const WRITE_VERB_SET = new Set(WRITE_VERBS);
const LEADING_ONLY_SET = new Set(LEADING_ONLY_WRITE_VERBS);
const CAMEL_CASE_BOUNDARY = /([a-z\d])([A-Z])/g;
const NON_ALPHANUMERIC = /[^A-Za-z\d]+/;

/**
 * Splits a tool name into lower-case words, whether it is camelCase, snake_case or kebab-case.
 * @param {string} name - Tool name.
 * @returns {string[]} The words in order.
 */
export function toolNameWords(name) {
  return name
    .replaceAll(CAMEL_CASE_BOUNDARY, '$1 $2')
    .split(NON_ALPHANUMERIC)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/**
 * Finds the first write verb in a tool name.
 * @param {string} name - Tool name.
 * @returns {string | undefined} The verb, or undefined when the name looks read-only.
 */
export function findWriteVerb(name) {
  const words = toolNameWords(name);
  return words.find(
    (word, index) => WRITE_VERB_SET.has(word) || (index === 0 && LEADING_ONLY_SET.has(word)),
  );
}

/**
 * Whether a tool name contains a write verb.
 * @param {string} name - Tool name.
 * @returns {boolean} True when the name suggests the tool changes something.
 */
export function isWriteToolName(name) {
  return findWriteVerb(name) !== undefined;
}

/**
 * Classifies a tool as read or write. A tool is "read" only if its name has no write verb and the
 * server does not mark it destructive or not read-only. Annotations can only make the result
 * stricter, never looser, because a server's own hints are not a reason to trust a write-sounding
 * name.
 * @param {ClassifiableTool} tool - The tool to classify.
 * @returns {ToolClassification} The classification and the reason for it.
 */
export function classifyTool({ name, annotations }) {
  const verb = findWriteVerb(name);
  if (verb !== undefined) {
    return { kind: 'write', reason: `name contains the write verb "${verb}"` };
  }
  if (annotations?.destructiveHint === true) {
    return { kind: 'write', reason: 'server marks it destructive' };
  }
  if (annotations?.readOnlyHint === false) {
    return { kind: 'write', reason: 'server does not mark it read-only' };
  }
  return { kind: 'read', reason: 'no write verb in the name' };
}
