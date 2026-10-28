// @ts-check
import { encodeBasicCredentials } from '../config/index.js';
import { pageFingerprint } from '../citations/index.js';

const API_GATEWAY = 'https://api.atlassian.com/ex/confluence';
const REQUEST_TIMEOUT_MS = 10_000;
const NOT_FOUND = 404;
const PAGE_ID = /^\d+$/;

/**
 * Looks at the live Confluence and says whether a page is still the version the model read. It
 * makes one read-only GET per page, only for pages in the allowed spaces, and never throws: a page
 * that cannot be checked is `unavailable`, and only a reason (a status, never a body, a page id or
 * a token) is logged.
 * @typedef {object} ConfluenceChecker
 * @property {(source: import('../citations/index.js').ConfluenceSource) => Promise<import('./github.js').CheckStatus>} check - Checks one page.
 */

/**
 * Builds the address and the Authorization header for the page lookup. A service-account key is
 * sent as a Bearer token through the Atlassian gateway, which needs the cloud id; a personal token
 * is sent as Basic `email:token` straight to the site.
 * @param {Pick<import('../config/index.js').AppConfig['atlassian'], 'siteUrl' | 'cloudId' | 'auth' | 'apiToken'>} atlassian - The Atlassian settings.
 * @param {string} id - The page id, already checked to be digits.
 * @returns {{ url: string, authorization: string } | undefined} The request, or undefined when the settings do not allow one.
 */
function buildRequest({ siteUrl, cloudId, auth, apiToken }, id) {
  // Oauth mode has no API token, and this REST route refuses the token of a person who signed in.
  if (apiToken === undefined) {
    return undefined;
  }
  if (auth.mode === 'basic') {
    return {
      url: `${siteUrl}/wiki/api/v2/pages/${id}`,
      authorization: `Basic ${encodeBasicCredentials(auth.email, apiToken)}`,
    };
  }
  return cloudId === undefined
    ? undefined
    : {
        url: `${API_GATEWAY}/${cloudId}/wiki/api/v2/pages/${id}`,
        authorization: `Bearer ${apiToken}`,
      };
}

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
 * Reads the version number out of a page lookup.
 * @param {unknown} body - The parsed answer.
 * @returns {number | undefined} The version, or undefined when the answer has none.
 */
function versionOf(body) {
  const page = asObject(body);
  const number = asObject(page.version).number;
  return typeof number === 'number' && Number.isInteger(number) ? number : undefined;
}

/**
 * Creates the checker.
 * @param {object} deps - What it needs.
 * @param {Pick<import('../config/index.js').AppConfig['atlassian'], 'siteUrl' | 'cloudId' | 'auth' | 'apiToken' | 'spaceKeys'>} deps.atlassian - The Atlassian settings.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} deps.logger - Where failures are logged.
 * @param {typeof fetch} [deps.fetch] - The fetch function; defaults to the global one.
 * @returns {ConfluenceChecker} The checker.
 */
export function createConfluenceChecker({
  atlassian,
  logger,
  fetch: fetchFunction = globalThis.fetch,
}) {
  const spaces = new Set(atlassian.spaceKeys.map((key) => key.toLowerCase()));

  /**
   * Fetches the live version of a page.
   * @param {{ url: string, authorization: string }} request - Where to ask.
   * @returns {Promise<'gone' | number | undefined>} The version, `gone` for a 404, or undefined when it cannot be read.
   */
  async function liveVersion({ url, authorization }) {
    const response = await fetchFunction(url, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === NOT_FOUND) {
      return 'gone';
    }
    if (!response.ok) {
      logger.warn({ status: response.status }, 'could not re-check a page');
      return undefined;
    }
    return versionOf(await response.json());
  }

  return {
    async check({ id, spaceKey, version, fingerprint = pageFingerprint(version) }) {
      const request = PAGE_ID.test(id) ? buildRequest(atlassian, id) : undefined;
      if (request === undefined || !spaces.has(spaceKey.toLowerCase())) {
        logger.warn(
          {},
          'did not re-check a page: it is outside the allowed spaces or not reachable',
        );
        return 'unavailable';
      }
      try {
        const version = await liveVersion(request);
        if (version === undefined) {
          return 'unavailable';
        }
        // A page that is gone is a change to what was read.
        return version === 'gone' || pageFingerprint(version) !== fingerprint
          ? 'changed'
          : 'unchanged';
      } catch (error) {
        logger.warn(
          { reason: error instanceof Error ? error.name : 'unknown' },
          'could not re-check a page',
        );
        return 'unavailable';
      }
    },
  };
}
