// @ts-check
import { MIN_TURN_TOKEN_MARGIN_MS } from '../atlassian/index.js';
import { pageFingerprint } from '../citations/index.js';
import { ATLASSIAN_MCP_URL } from '../mcp/index.js';

/** The one tool this checker calls. It only reads. */
export const PAGE_TOOL = 'getConfluenceContent';

/**
 * How much of the page to ask for, cheapest first. The summary is enough when it carries the
 * version; otherwise the full page is read, which always does.
 */
export const DETAIL_ORDER = Object.freeze(['summary', 'full']);

const PAGE_ID = /^\d+$/;
const TEXT = 'text';

/**
 * The part of an MCP client the checker uses.
 * @typedef {Pick<import('@modelcontextprotocol/sdk/client/index.js').Client, 'callTool' | 'close'>} PageClient
 */

/**
 * What the checker needs.
 * @typedef {object} McpCheckerDeps
 * @property {Pick<import('../config/index.js').AppConfig['atlassian'], 'siteUrl' | 'cloudId' | 'spaceKeys'>} atlassian - The site, its cloud id and the allowed spaces.
 * @property {import('../atlassian/index.js').TokenProvider['getAtlassianToken']} getAtlassianToken - The signed-in token.
 * @property {(endpoint: import('../mcp/discovery.js').ServerEndpoint) => Promise<PageClient>} connect - Opens an MCP connection.
 * @property {number} timeoutMs - The MCP time limit.
 * @property {Pick<import('../logger/index.js').Logger, 'warn'>} logger - Where failures are logged.
 */

/**
 * Reads a value as a plain object.
 * @param {unknown} value - Any value.
 * @returns {Record<string, unknown>} The object, or an empty one.
 */
function asObject(value) {
  return typeof value === 'object' && value !== null
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Reads the version of the page a tool call returned, the way the citation extractor does.
 * @param {unknown} result - What the tool returned.
 * @param {string} id - The page that was asked for.
 * @returns {number | undefined} The version, or undefined when the result has none or is another page.
 */
export function versionFromResult(result, id) {
  const outcome = asObject(result);
  const content = Array.isArray(outcome.content) ? outcome.content : [];
  const text = content.map(asObject).find((part) => part.type === TEXT)?.text;
  if (outcome.isError === true || typeof text !== 'string') {
    return undefined;
  }
  let data;
  try {
    data = asObject(asObject(JSON.parse(text)).data);
  } catch {
    return undefined;
  }
  const number = asObject(asObject(data.metadata).version).number;
  return data.id === id && typeof number === 'number' && Number.isInteger(number)
    ? number
    : undefined;
}

/**
 * Creates the Confluence checker for oauth mode. Atlassian's REST gateway refuses the token of a
 * person who signed in, so the page's version is read over MCP with `getConfluenceContent`, as the
 * model reads it, but app-side: no Copilot request. It is called with the configured cloud id and
 * a page address built from the allowed space and the page id, never from text the model wrote.
 * - Pages outside the allowed spaces are never asked for.
 * - A batch of checks shares one connection, opened when the first page needs it.
 * - It never throws. A page that cannot be read, including one that was deleted, is
 *   `unavailable`: over MCP a missing page cannot be told apart from a failure, and a source that
 *   cannot be checked is never reported as changed. Only a reason is logged.
 * @param {McpCheckerDeps} deps - Settings and dependencies.
 * @returns {import('./confluence.js').ConfluenceChecker & { batch: NonNullable<import('./confluence.js').ConfluenceChecker['batch']> }} The checker.
 */
export function createMcpConfluenceChecker({
  atlassian,
  getAtlassianToken,
  connect,
  timeoutMs,
  logger,
}) {
  const spaces = new Set(atlassian.spaceKeys.map((key) => key.toLowerCase()));

  /**
   * Opens the connection a batch shares, with a token that lasts it.
   * @returns {Promise<PageClient>} The connected client.
   */
  async function open() {
    const { accessToken } = await getAtlassianToken({ minValidityMs: MIN_TURN_TOKEN_MARGIN_MS });
    return connect({
      url: ATLASSIAN_MCP_URL,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: timeoutMs,
    });
  }

  /**
   * Reads the live version of a page, asking for the summary first.
   * @param {PageClient} client - The connection.
   * @param {{ id: string, spaceKey: string }} page - The page.
   * @returns {Promise<number | undefined>} The version, or undefined when it cannot be read.
   */
  async function liveVersion(client, { id, spaceKey }) {
    const contentUrl = `${atlassian.siteUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${id}`;
    for (const detail of DETAIL_ORDER) {
      const result = await client.callTool({
        name: PAGE_TOOL,
        arguments: { cloudId: atlassian.cloudId, content_url: contentUrl, detail },
      });
      const version = versionFromResult(result, id);
      if (version !== undefined) {
        return version;
      }
    }
    return undefined;
  }

  /**
   * Checks one page over a connection the batch opens once.
   * @param {import('../citations/index.js').ConfluenceSource} source - The page.
   * @param {() => Promise<PageClient>} client - Gives the batch's connection.
   * @returns {Promise<import('./github.js').CheckStatus>} What the check found.
   */
  async function checkPage(
    { id, spaceKey, version, fingerprint = pageFingerprint(version) },
    client,
  ) {
    if (!PAGE_ID.test(id) || !spaces.has(spaceKey.toLowerCase())) {
      logger.warn({}, 'did not re-check a page: it is outside the allowed spaces or not reachable');
      return 'unavailable';
    }
    try {
      const live = await liveVersion(await client(), { id, spaceKey });
      if (live === undefined) {
        logger.warn({}, 'could not re-check a page over MCP');
        return 'unavailable';
      }
      return pageFingerprint(live) === fingerprint ? 'unchanged' : 'changed';
    } catch (error) {
      logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'could not re-check a page over MCP',
      );
      return 'unavailable';
    }
  }

  /** @type {NonNullable<import('./confluence.js').ConfluenceChecker['batch']>} */
  async function batch(run) {
    /** @type {Promise<PageClient> | undefined} */
    let opened;
    const client = () => {
      opened ??= open();
      return opened;
    };
    try {
      return await run({ check: (source) => checkPage(source, client) });
    } finally {
      // A failure to connect was already reported by each check that needed the connection.
      const connection = await opened?.catch(() => undefined);
      await connection?.close().catch(() => {
        logger.warn({}, 'could not close the re-check connection');
      });
    }
  }

  return {
    batch,
    check: (source) => batch((pages) => pages.check(source)),
  };
}
