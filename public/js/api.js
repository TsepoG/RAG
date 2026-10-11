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
   */
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    /** @type {number | undefined} */
    this.status = status;
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
 * Reads the message the server put in an error response.
 * @param {Response} response - A response that is not ok.
 * @returns {Promise<string>} The server's message, or the status text.
 */
async function messageOf(response) {
  try {
    const body = await response.json();
    if (typeof body?.message === 'string') {
      return body.message;
    }
  } catch {
    // The body was not JSON; fall through to the status text.
  }
  return response.statusText || FALLBACK_MESSAGE;
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
    throw new ApiError(await messageOf(response), response.status);
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
 * @returns {Promise<Array<{ id: string, displayName: string, description: string, depth: number }>>} The roles.
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
 * Asks a question and reports each event of the answer as it arrives. EventSource cannot send a
 * POST, so the stream is read from the response body. Resolves when the stream ends.
 * @param {object} request - The question.
 * @param {string} request.question - What to ask.
 * @param {string} request.role - The role id.
 * @param {'default' | 'more'} request.detailLevel - How much detail to ask for.
 * @param {AbortSignal} [request.signal] - Aborting it stops reading, and the server stops the question.
 * @param {(event: StreamEvent) => void} request.onEvent - Called for each event, in order.
 * @param {FetchFunction} [request.fetchFunction] - Replaces `fetch`.
 * @returns {Promise<void>} Resolves once the stream has ended.
 * @throws {ApiError} When the server refuses the question, cannot be reached, or sends unreadable data.
 * @throws {DOMException} An AbortError when `signal` is aborted.
 */
export async function askStream({
  question,
  role,
  detailLevel,
  signal,
  onEvent,
  fetchFunction = (...args) => fetch(...args),
}) {
  const response = await send(
    fetchFunction,
    '/ask',
    postJson({ question, role, detailLevel }, signal),
  );
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
