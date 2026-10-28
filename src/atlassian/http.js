// @ts-check
import { AtlassianAuthError } from '../errors/index.js';

// Every call to Atlassian's sign-in endpoints goes through here. A failure is described by its
// HTTP status and, when the body carries one, its OAuth error code: never the body itself, which
// can echo a token or a code.

/**
 * How long one request to Atlassian may take. Well under the lock's stale age, so a renewal that
 * holds the lock always finishes, one way or the other, before the lock could be broken.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** An OAuth error code: lower-case letters and underscores, as RFC 6749 names them. */
const OAUTH_ERROR_PATTERN = /^[a-z_]{1,64}$/;

const FORM_TYPE = 'application/x-www-form-urlencoded';
const JSON_TYPE = 'application/json';

/**
 * What came back from Atlassian: the status, and the body when it was JSON.
 * @typedef {object} HttpResult
 * @property {boolean} ok - Whether the status was 2xx.
 * @property {number} status - The HTTP status.
 * @property {unknown} body - The parsed JSON body, or undefined when it was not JSON.
 */

/**
 * Parses JSON without throwing.
 * @param {string} text - The text.
 * @returns {unknown} The value, or undefined when it is not JSON.
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Sends one request and reads its body.
 * @param {typeof fetch} fetchFunction - The fetch to use.
 * @param {string} url - Where to send it.
 * @param {RequestInit} init - The request.
 * @param {string} what - What the request is for, in words ("renew the sign-in").
 * @returns {Promise<HttpResult>} The status and body.
 * @throws {AtlassianAuthError} When Atlassian cannot be reached or does not answer in time.
 */
export async function send(fetchFunction, url, init, what) {
  let response;
  try {
    response = await fetchFunction(url, {
      ...init,
      headers: { Accept: JSON_TYPE, ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AtlassianAuthError('failed', `Could not reach Atlassian to ${what}`, {
      cause: error,
    });
  }
  return { ok: response.ok, status: response.status, body: parseJson(await response.text()) };
}

/**
 * Reads a JSON document.
 * @param {typeof fetch} fetchFunction - The fetch to use.
 * @param {string} url - The document.
 * @param {string} what - What it is for, in words.
 * @returns {Promise<unknown>} The parsed body.
 * @throws {AtlassianAuthError} When it cannot be read.
 */
export async function getJson(fetchFunction, url, what) {
  const result = await send(fetchFunction, url, { method: 'GET' }, what);
  if (!result.ok) {
    throw new AtlassianAuthError('failed', describeFailure(what, result));
  }
  return result.body;
}

/**
 * Posts a form, as the token and revocation endpoints expect.
 * @param {typeof fetch} fetchFunction - The fetch to use.
 * @param {string} url - The endpoint.
 * @param {Record<string, string>} form - The fields.
 * @param {string} what - What it is for, in words.
 * @returns {Promise<HttpResult>} The status and body.
 * @throws {AtlassianAuthError} When Atlassian cannot be reached.
 */
export function postForm(fetchFunction, url, form, what) {
  return send(
    fetchFunction,
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': FORM_TYPE },
      body: new URLSearchParams(form).toString(),
    },
    what,
  );
}

/**
 * Posts JSON, as the registration endpoint expects.
 * @param {typeof fetch} fetchFunction - The fetch to use.
 * @param {string} url - The endpoint.
 * @param {unknown} payload - The body.
 * @param {string} what - What it is for, in words.
 * @returns {Promise<HttpResult>} The status and body.
 * @throws {AtlassianAuthError} When Atlassian cannot be reached.
 */
export function postJson(fetchFunction, url, payload, what) {
  return send(
    fetchFunction,
    url,
    { method: 'POST', headers: { 'Content-Type': JSON_TYPE }, body: JSON.stringify(payload) },
    what,
  );
}

/**
 * Reads the OAuth error code from an error answer. Anything that is not shaped like one is left
 * out, so a body can never smuggle text into a message.
 * @param {unknown} body - The parsed body.
 * @returns {string | undefined} The error code, if there is a usable one.
 */
export function oauthErrorOf(body) {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const { error } = /** @type {{ error?: unknown }} */ (body);
  return typeof error === 'string' && OAUTH_ERROR_PATTERN.test(error) ? error : undefined;
}

/**
 * Describes a failed request by its status and OAuth error code only.
 * @param {string} what - What the request was for, in words.
 * @param {Pick<HttpResult, 'status' | 'body'>} result - The answer.
 * @returns {string} For example "Could not renew the sign-in (HTTP 400, invalid_grant)".
 */
export function describeFailure(what, { status, body }) {
  return describeRefusal(what, status, oauthErrorOf(body));
}

/**
 * Describes a refusal whose OAuth error code has already been read.
 * @param {string} what - What the request was for, in words.
 * @param {number} status - The HTTP status.
 * @param {string | undefined} error - The OAuth error code, if any.
 * @returns {string} For example "Could not renew the sign-in (HTTP 400, invalid_grant)".
 */
export function describeRefusal(what, status, error) {
  const code = error === undefined ? '' : `, ${error}`;
  return `Could not ${what} (HTTP ${status}${code})`;
}
