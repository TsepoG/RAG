// @ts-check
import { z } from 'zod';
import { AtlassianAuthError } from '../errors/index.js';
import { ATLASSIAN_MCP_URL } from '../mcp/index.js';

/** The MCP tool that lists the Atlassian sites an account can reach. */
export const RESOURCES_TOOL = 'getAccessibleAtlassianResources';

const TEXT = 'text';

// The tool publishes no output schema. Its text is JSON shaped like
// { data: { resources: [{ cloudId, url, products }] } }; only the two fields used are checked.
const resourcesSchema = z.object({
  data: z.object({
    resources: z.array(z.object({ cloudId: z.string(), url: z.string() })),
  }),
});

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

/**
 * The part of an MCP client the site check uses.
 * @typedef {Pick<import('@modelcontextprotocol/sdk/client/index.js').Client, 'callTool' | 'close'>} IdentityClient
 */

/**
 * What the site check found: the site's host for the signed-in panel, or that the account cannot
 * reach the configured site.
 * @typedef {{ ok: true, siteHost: string } | { ok: false, reason: 'wrong-site' }} SiteCheck
 */

/**
 * The error for an answer that does not say which sites the account can reach. It never quotes the
 * answer.
 * @returns {AtlassianAuthError} The error.
 */
function unreadable() {
  return new AtlassianAuthError(
    'failed',
    'Atlassian did not say which sites this account can reach',
  );
}

/**
 * Reads the sites out of the tool's answer.
 * @param {unknown} result - What the tool returned.
 * @returns {Array<{ cloudId: string, url: string }>} The sites.
 * @throws {AtlassianAuthError} When the answer is an error or not in the expected shape.
 */
function sitesOf(result) {
  const parsed = toolResultSchema.safeParse(result);
  const text = parsed.success
    ? parsed.data.content.find(({ type }) => type === TEXT)?.text
    : undefined;
  const sites = text === undefined || parsed.data?.isError ? undefined : parseSites(text);
  if (sites === undefined) {
    throw unreadable();
  }
  return sites;
}

/**
 * Parses the tool's text.
 * @param {string} text - The text.
 * @returns {Array<{ cloudId: string, url: string }> | undefined} The sites, or undefined when the text is not in the expected shape.
 */
function parseSites(text) {
  try {
    const parsed = resourcesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.data.resources : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The origin of a URL, or undefined when it is not one.
 * @param {string} url - The URL.
 * @returns {string | undefined} Its origin.
 */
function originOf(url) {
  return URL.canParse(url) ? new URL(url).origin : undefined;
}

/**
 * Checks that the account that just signed in can reach the configured Atlassian site. It calls the
 * MCP tool directly, with the new token, not through Copilot. The site must match on both the cloud
 * id and the address, so a sign-in to another site gets a clear message instead of empty answers.
 * @param {object} request - The check.
 * @param {string} request.accessToken - The new access token.
 * @param {string} request.cloudId - ATLASSIAN_CLOUD_ID.
 * @param {string} request.siteUrl - ATLASSIAN_SITE_URL, as an origin.
 * @param {number} request.timeoutMs - The MCP time limit.
 * @param {(endpoint: import('../mcp/discovery.js').ServerEndpoint) => Promise<IdentityClient>} request.connect - Opens the MCP connection.
 * @returns {Promise<SiteCheck>} The site's host, or that the account cannot reach it.
 * @throws {AtlassianAuthError} When the MCP server cannot be reached or its answer cannot be read.
 */
export async function checkSite({ accessToken, cloudId, siteUrl, timeoutMs, connect }) {
  let client;
  try {
    client = await connect({
      url: ATLASSIAN_MCP_URL,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: timeoutMs,
    });
  } catch {
    // The MCP client's message can quote the server's answer, so it is not kept.
    throw new AtlassianAuthError(
      'failed',
      'Could not reach the Atlassian MCP server to check the site',
    );
  }
  try {
    const result = await client.callTool({ name: RESOURCES_TOOL, arguments: {} }).catch(() => {
      throw unreadable();
    });
    const site = sitesOf(result).find(
      (candidate) => candidate.cloudId === cloudId && originOf(candidate.url) === siteUrl,
    );
    return site === undefined
      ? { ok: false, reason: 'wrong-site' }
      : { ok: true, siteHost: new URL(siteUrl).host };
  } finally {
    await client.close();
  }
}
