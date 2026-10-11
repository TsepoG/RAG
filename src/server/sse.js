// @ts-check
import { AppError } from '../errors/index.js';

/** The events the page understands. Anything else is a bug, so it is refused. */
const EVENT_NAMES = Object.freeze(['progress', 'token', 'done', 'error']);

/** The events that end a stream. A stream has exactly one. */
const TERMINAL_EVENTS = Object.freeze(['done', 'error']);

/** HTTP status of an event stream that has started. */
const OK = 200;

/** Headers every event stream needs; the caller adds the security headers. */
const STREAM_HEADERS = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
});

/**
 * The parts of a Node response a stream uses.
 * @typedef {Pick<import('node:http').ServerResponse, 'writeHead' | 'write' | 'end' | 'on' | 'flushHeaders'> & {
 *   writableEnded: boolean, destroyed: boolean,
 * }} StreamResponse
 */

/**
 * An open Server-Sent Events stream.
 * @typedef {object} EventStream
 * @property {(event: string, data: unknown) => boolean} send - Writes one event. Returns false,
 *   and writes nothing, once the stream has ended or the client has gone.
 * @property {(event: string, data: unknown) => boolean} finish - Writes the `done` or `error`
 *   event and ends the stream. Only the first call does anything; it returns whether it did.
 * @property {() => boolean} isOpen - Whether events can still be written.
 * @property {(listener: () => void) => void} onDisconnect - Calls the listener if the client goes
 *   away before the stream has finished.
 */

/**
 * Formats one event in the Server-Sent Events wire format. The data is JSON, which never
 * contains a raw line break, so it fits on one `data:` line.
 * @param {string} event - One of the known event names.
 * @param {unknown} data - Anything JSON can hold.
 * @returns {string} The text to write.
 * @throws {AppError} When the event name is not a known one.
 */
export function formatEvent(event, data) {
  if (!EVENT_NAMES.includes(event)) {
    throw new AppError(`Unknown event: ${event}`);
  }
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Starts an event stream on a response the framework no longer manages, so the caller passes in
 * the security headers that the framework would have added.
 * @param {StreamResponse} response - The raw response.
 * @param {Readonly<Record<string, string>>} [extraHeaders] - Added to the stream headers.
 * @returns {EventStream} The open stream.
 */
export function openEventStream(response, extraHeaders = {}) {
  let finished = false;
  response.writeHead(OK, { ...extraHeaders, ...STREAM_HEADERS });
  response.flushHeaders();

  const isOpen = () => !finished && !response.writableEnded && !response.destroyed;
  const send = (/** @type {string} */ event, /** @type {unknown} */ data) => {
    if (!isOpen()) {
      return false;
    }
    // A false return only means the buffer is full; the data is queued, so it was still written.
    response.write(formatEvent(event, data));
    return true;
  };
  const finish = (/** @type {string} */ event, /** @type {unknown} */ data) => {
    if (!TERMINAL_EVENTS.includes(event)) {
      throw new AppError(`Not an event that ends a stream: ${event}`);
    }
    if (!send(event, data)) {
      return false;
    }
    finished = true;
    response.end();
    return true;
  };
  const onDisconnect = (/** @type {() => void} */ listener) => {
    response.on('close', () => {
      if (!finished) {
        finished = true;
        listener();
      }
    });
  };
  return { send, finish, isOpen, onDisconnect };
}
