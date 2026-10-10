// @ts-check
import { McpError } from '../errors/index.js';
import { classifyTool } from './classify.js';

/**
 * A tool as an MCP server lists it.
 * @typedef {object} ListedTool
 * @property {string} name - Tool name.
 * @property {string} [description] - What the server says the tool does.
 * @property {import('./classify.js').ToolAnnotations} [annotations] - The server's hints.
 */

/**
 * Where to reach one MCP server.
 * @typedef {object} ServerEndpoint
 * @property {string} url - Server URL.
 * @property {Record<string, string>} [headers] - Request headers, including credentials.
 * @property {number} [timeout] - Per-request time limit in milliseconds.
 */

/**
 * The part of an MCP client that discovery uses.
 * @typedef {object} ToolLister
 * @property {(
 *   params?: { cursor?: string },
 *   options?: { timeout?: number },
 * ) => Promise<{ tools: ListedTool[], nextCursor?: string }>} listTools - Lists one page of tools.
 * @property {() => Promise<void>} close - Closes the connection.
 */

/**
 * Opens a connection to a server. Injected so tests never touch the network.
 * @typedef {(endpoint: ServerEndpoint) => Promise<ToolLister>} Connect
 */

/**
 * One tool in the report, with its classification.
 * @typedef {object} ReportedTool
 * @property {string} name - Tool name.
 * @property {string} description - One-line description, possibly empty.
 * @property {'read' | 'write'} kind - Whether the tool may change anything.
 * @property {string} reason - Why it was classified that way.
 */

/**
 * Everything one server offers.
 * @typedef {object} ServerReport
 * @property {string} key - The key the server is registered under.
 * @property {string} url - Server URL.
 * @property {ReportedTool[]} tools - Its tools, sorted by name.
 */

const MAX_LIST_PAGES = 20;
const MAX_DESCRIPTION_LENGTH = 160;
const ELLIPSIS = '…';
const WHITESPACE = /\s+/g;
const PIPE = /\|/g;

/**
 * Reads every page of a server's tool list.
 * @param {ToolLister} client - A connected client.
 * @param {number | undefined} timeout - Per-request time limit in milliseconds.
 * @returns {Promise<ListedTool[]>} All tools.
 * @throws {McpError} When the server keeps returning more pages than is plausible.
 */
async function collectPages(client, timeout) {
  /** @type {ListedTool[]} */
  const tools = [];
  /** @type {string | undefined} */
  let cursor;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const params = cursor === undefined ? undefined : { cursor };
    const result = await client.listTools(params, { timeout });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (cursor === undefined) {
      return tools;
    }
  }
  throw new McpError(`The server returned more than ${MAX_LIST_PAGES} pages of tools`);
}

/**
 * Lists every tool one MCP server offers.
 * @param {string} key - The key the server is registered under, used in error messages.
 * @param {ServerEndpoint} endpoint - Where to reach it.
 * @param {Connect} connect - Opens the connection.
 * @returns {Promise<ListedTool[]>} All tools the server lists.
 * @throws {McpError} When the server cannot be reached or answers unusably; `cause` has the detail.
 */
export async function listServerTools(key, endpoint, connect) {
  try {
    const client = await connect(endpoint);
    try {
      return await collectPages(client, endpoint.timeout);
    } finally {
      await client.close();
    }
  } catch (error) {
    throw new McpError(`Could not list the tools of the "${key}" MCP server`, { cause: error });
  }
}

/**
 * Collapses a description to one table-safe line, shortened if it is long.
 * @param {string | undefined} text - The server's description.
 * @returns {string} A single line with pipes escaped, at most 160 characters before escaping.
 */
function toOneLine(text) {
  const line = (text ?? '').replaceAll(WHITESPACE, ' ').trim();
  const short =
    line.length > MAX_DESCRIPTION_LENGTH
      ? `${line.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}${ELLIPSIS}`
      : line;
  return short.replaceAll(PIPE, '\\|');
}

/**
 * Lists and classifies the tools of every server, one after another.
 * @param {Record<string, ServerEndpoint>} servers - Endpoints by server key.
 * @param {Connect} connect - Opens a connection.
 * @returns {Promise<ServerReport[]>} One report per server, in the order given.
 * @throws {McpError} When any server cannot be listed.
 */
export async function collectToolReport(servers, connect) {
  /** @type {ServerReport[]} */
  const report = [];
  for (const [key, endpoint] of Object.entries(servers)) {
    const listed = await listServerTools(key, endpoint, connect);
    const tools = listed
      .map((tool) => ({
        name: tool.name,
        description: toOneLine(tool.description),
        ...classifyTool(tool),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    report.push({ key, url: endpoint.url, tools });
  }
  return report;
}

/**
 * Renders one server's section of the report.
 * @param {ServerReport} server - The server's tools.
 * @returns {string[]} Markdown lines.
 */
function renderServer({ key, url, tools }) {
  const writes = tools.filter((tool) => tool.kind === 'write').length;
  const counts = `${tools.length} tools: ${tools.length - writes} read, ${writes} write.`;
  const rows = tools.map(
    (tool) => `| \`${tool.name}\` | ${tool.kind} | ${tool.reason} | ${tool.description} |`,
  );
  const table =
    tools.length === 0
      ? ['No tools returned.']
      : ['| Tool | Class | Why | Description |', '| --- | --- | --- | --- |', ...rows];
  return [`## ${key}`, '', `URL: ${url}`, '', counts, '', ...table, ''];
}

/**
 * Renders the discovery report as the Markdown kept in docs/mcp-tools.md.
 * @param {ServerReport[]} report - The tools of every server.
 * @param {string} generatedAt - When the report was made, as an ISO timestamp.
 * @returns {string} The Markdown document.
 */
export function renderToolsMarkdown(report, generatedAt) {
  const header = [
    '# MCP tools',
    '',
    `Generated ${generatedAt} by \`npm run mcp:tools\`. Do not edit by hand; run it again to refresh.`,
    '',
    'A tool is classed "read" only when its name has no write verb and the server does not mark it',
    'destructive or not read-only. The allow-lists in `src/mcp/allowlist.js` are a hand-reviewed',
    'subset of the read tools below. The GitHub server is asked for read-only tools, so it lists',
    'no write tools at all.',
    '',
  ];
  return [...header, ...report.flatMap(renderServer)].join('\n');
}
