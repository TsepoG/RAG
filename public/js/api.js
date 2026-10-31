// @ts-check
import { createSseParser } from './sseParser.js';

/** Where the server's API is, relative to the page. */
const API = '/api';
const JSON_TYPE = 'application/json';

/** Shown when the server did not give a message of its own. */
const FALLBACK_MESSAGE = 'The server could not be reached. Is it still running?';

/**
 * A failed request to the server.
 */
export class ApiError extends Error {
  /**
   * Creates the error.
   * @param {string} message - What to show.
   * @param {number} [status] - The HTTP status, when the server answered at all.
   * @param {string} [code] - The code the server gave for what went wrong, such as `conversation_ended`.
   * @param {string} [reason] - Why, when the server says: for `github_signin_required`, what the person
   *   has to do (`logged-out`, `sso` or `cli-missing`).
   */
  constructor(message, status, code, reason) {
    super(message);
    this.name = 'ApiError';
    /** @type {number | undefined} */
    this.status = status;
    /** @type {string | undefined} */
    this.code = code;
    if (reason !== undefined) {
      /** @type {string | undefined} */
      this.reason = reason;
    }
  }
}

/**
 * What a function that calls the server may be given in place of `fetch`, so tests need no server.
 * @typedef {typeof fetch} FetchFunction
 */

/**
 * One event from the answer stream, with its data already parsed.
 * @typedef {{ event: string, data: unknown }} StreamEvent
 */

/**
 * Reads the message and the code the server put in an error response.
 * @param {Response} response - A response that is not ok.
 * @returns {Promise<{ message: string, code: string | undefined, reason: string | undefined }>} The message the server gave,
 *   or the status text, and its code if it gave one.
 */
async function describeError(response) {
  try {
    const body = await response.json();
    if (typeof body?.message === 'string') {
      return {
        message: body.message,
        code: typeof body.code === 'string' ? body.code : undefined,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      };
    }
  } catch {
    // The body was not JSON; fall through to the status text.
  }
  return { message: response.statusText || FALLBACK_MESSAGE, code: undefined, reason: undefined };
}

/**
 * Sends a request and turns a failure into an ApiError.
 * @param {FetchFunction} fetchFunction - Sends the request.
 * @param {string} path - The path under the API.
 * @param {RequestInit} init - The request.
 * @returns {Promise<Response>} The response, known to be ok.
 * @throws {ApiError} When the server cannot be reached or answers with an error.
 */
async function send(fetchFunction, path, init) {
  /** @type {Response} */
  let response;
  try {
    response = await fetchFunction(`${API}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(FALLBACK_MESSAGE);
  }
  if (!response.ok) {
    const { message, code, reason } = await describeError(response);
    throw new ApiError(message, response.status, code, reason);
  }
  return response;
}

/**
 * Builds the options for a POST with a JSON body.
 * @param {unknown} body - What to send.
 * @param {AbortSignal} [signal] - Aborting it cancels the request.
 * @returns {RequestInit} The options.
 */
function postJson(body, signal) {
  return {
    method: 'POST',
    headers: { 'Content-Type': JSON_TYPE },
    body: JSON.stringify(body),
    signal,
  };
}

/**
 * Loads the roles the picker offers.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<Array<{ id: string, displayName: string, description: string, depth: number, suggestedQuestions?: string[] }>>} The roles; `suggestedQuestions` is there only when the role has some.
 * @throws {ApiError} When the server cannot be reached or answers with an error.
 */
export async function fetchRoles(fetchFunction = (...args) => fetch(...args)) {
  const response = await send(fetchFunction, '/roles', { headers: { Accept: JSON_TYPE } });
  return response.json();
}

/**
 * Parses the data of one event.
 * @param {{ event: string, data: string }} message - The raw event.
 * @returns {StreamEvent} The event with its data parsed.
 * @throws {ApiError} When the data is not JSON.
 */
function parseMessage({ event, data }) {
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    throw new ApiError('The server sent something the page could not read.');
  }
}

/**
 * Reads an event stream from a response body, reporting each event as it arrives. EventSource
 * cannot send a POST, so the stream is read from the response body.
 * @param {Response} response - A response with an event stream as its body.
 * @param {(event: StreamEvent) => void} onEvent - Called for each event, in order.
 * @returns {Promise<void>} Resolves once the stream has ended.
 * @throws {ApiError} When there is no body, or an event holds data that is not JSON.
 */
async function readEvents(response, onEvent) {
  if (response.body === null) {
    throw new ApiError('The server sent no answer.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    for (const message of parser.push(decoder.decode(value, { stream: true }))) {
      onEvent(parseMessage(message));
    }
  }
}

/**
 * Starts a conversation.
 * @param {string} role - The role id.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<{ conversationId: string, maxTurns: number }>} Its id and turn cap.
 * @throws {ApiError} When the server cannot be reached or refuses.
 */
export async function createConversation(role, fetchFunction = (...args) => fetch(...args)) {
  const response = await send(fetchFunction, '/conversations', postJson({ role }));
  return response.json();
}

/**
 * Asks a question in a conversation and reports each event of the answer as it arrives: progress
 * and tokens, then `done`, then (separately) `recheck`. Resolves when the stream ends.
 * @param {object} request - The question.
 * @param {string} request.conversationId - The conversation.
 * @param {string} request.question - What to ask.
 * @param {'default' | 'more'} request.detailLevel - How much detail to ask for.
 * @param {string} [request.reaskAnswerId] - An earlier answer to ask again with the latest versions of its sources.
 * @param {AbortSignal} [request.signal] - Aborting it stops reading, and the server stops that turn.
 * @param {(event: StreamEvent) => void} request.onEvent - Called for each event, in order.
 * @param {FetchFunction} [request.fetchFunction] - Replaces `fetch`.
 * @returns {Promise<void>} Resolves once the stream has ended.
 * @throws {ApiError} When the server refuses the question, cannot be reached, or sends unreadable data.
 * @throws {DOMException} An AbortError when `signal` is aborted.
 */
export async function sendMessage({
  conversationId,
  question,
  detailLevel,
  reaskAnswerId,
  signal,
  onEvent,
  fetchFunction = (...args) => fetch(...args),
}) {
  const response = await send(
    fetchFunction,
    `/conversations/${conversationId}/messages`,
    postJson(
      { question, detailLevel, ...(reaskAnswerId === undefined ? {} : { reaskAnswerId }) },
      signal,
    ),
  );
  await readEvents(response, onEvent);
}

/**
 * Reads a conversation back, for a page that is reloading or catching up.
 * @param {string} conversationId - The conversation.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<import('./chatState.js').Transcript>} The transcript.
 * @throws {ApiError} When it is gone (code `conversation_ended`) or the server cannot be reached.
 */
export async function fetchConversation(
  conversationId,
  fetchFunction = (...args) => fetch(...args),
) {
  const response = await send(fetchFunction, `/conversations/${conversationId}`, {
    headers: { Accept: JSON_TYPE },
  });
  return response.json();
}

/**
 * Ends a conversation. The body is `{}` because the server wants a JSON body on every change.
 * @param {string} conversationId - The conversation.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<void>} Resolves once the server has ended it.
 * @throws {ApiError} When it was already gone or the server cannot be reached.
 */
export async function deleteConversation(
  conversationId,
  fetchFunction = (...args) => fetch(...args),
) {
  await send(fetchFunction, `/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': JSON_TYPE },
    body: '{}',
  });
}

/**
 * Asks the server to check an answer's sources again now.
 * @param {string} conversationId - The conversation.
 * @param {string} answerId - The answer.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<import('./chatState.js').RecheckPayload>} What was found, and the answers whose sources were checked.
 * @throws {ApiError} When the server refuses or cannot be reached.
 */
export async function recheckAnswer(
  conversationId,
  answerId,
  fetchFunction = (...args) => fetch(...args),
) {
  const response = await send(
    fetchFunction,
    `/conversations/${conversationId}/recheck`,
    postJson({ answerId }),
  );
  return response.json();
}

/**
 * Sends a thumbs up or down for an answer.
 * @param {object} feedback - What the person said.
 * @param {string} feedback.answerId - The id the server gave with the answer.
 * @param {'up' | 'down'} feedback.rating - Thumbs up or down.
 * @param {string} [feedback.comment] - An optional comment.
 * @param {string} [feedback.wrongSourceKey] - The key of a source they say is wrong.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<void>} Resolves once the server has saved it.
 * @throws {ApiError} When the server cannot be reached or refuses it.
 */
export async function sendFeedback(feedback, fetchFunction = (...args) => fetch(...args)) {
  await send(fetchFunction, '/feedback', postJson(feedback));
}

/**
 * Whether someone is signed in to Atlassian. In basic and bearer modes the service account always
 * is; in oauth mode the person signs in from the page.
 * @typedef {object} AuthStatus
 * @property {string} mode - `basic`, `bearer` or `oauth`.
 * @property {boolean} signedIn - Whether a sign-in is there.
 * @property {string} [siteHost] - The Atlassian site the sign-in reaches, in oauth mode.
 * @property {number} [expiresAt] - When the current token runs out, in ms; it is renewed by itself.
 * @property {GithubStatus} [github] - How GitHub is read, and in gh-cli mode whether the GitHub CLI
 *   has a token and whose.
 */

/**
 * What the server says about GitHub. It never holds a token.
 * @typedef {object} GithubStatus
 * @property {string} mode - `token` or `gh-cli`.
 * @property {boolean} signedIn - Whether there is a token to use.
 * @property {string} [login] - The GitHub CLI's account, when gh can say.
 * @property {string} [reason] - Why there is no token: `logged-out`, `sso` or `cli-missing`.
 */

/**
 * Reads whether someone is signed in to Atlassian.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<AuthStatus>} The status.
 * @throws {ApiError} When the server cannot be reached or answers with an error.
 */
export async function fetchAuthStatus(fetchFunction = (...args) => fetch(...args)) {
  const response = await send(fetchFunction, '/auth/status', { headers: { Accept: JSON_TYPE } });
  return response.json();
}

/**
 * Asks the server to look at the GitHub CLI again, after the person logged in in a terminal.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<AuthStatus>} The status, GitHub's looked at afresh.
 * @throws {ApiError} When the server cannot be reached or refuses.
 */
export async function checkGithub(fetchFunction = (...args) => fetch(...args)) {
  const response = await send(fetchFunction, '/auth/github/check', postJson({}));
  return response.json();
}

/**
 * Signs out of Atlassian: the server revokes the sign-in, forgets it, and ends the conversation.
 * @param {FetchFunction} [fetchFunction] - Replaces `fetch`.
 * @returns {Promise<{ signedOut: boolean, revoked: boolean }>} Whether Atlassian also revoked it.
 * @throws {ApiError} When the server cannot be reached or refuses.
 */
export async function signOut(fetchFunction = (...args) => fetch(...args)) {
  const response = await send(fetchFunction, '/auth/atlassian/logout', postJson({}));
  return response.json();
}
