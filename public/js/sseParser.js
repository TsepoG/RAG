// @ts-check

/** The event name when a message does not give one. */
const DEFAULT_EVENT = 'message';

/**
 * One Server-Sent Event.
 * @typedef {{ event: string, data: string }} SseMessage
 */

/**
 * Reads a Server-Sent Events stream, which arrives in arbitrary pieces.
 * @typedef {object} SseParser
 * @property {(chunk: string) => SseMessage[]} push - Adds the next piece of text and returns the
 *   events that are now complete. An event split across pieces comes out once its last piece arrives.
 */

/**
 * Finds where the next line ends. A line ends at a line feed, a carriage return, or both together.
 * @param {string} text - The buffered text.
 * @returns {{ end: number, next: number } | undefined} Where the line stops and the next begins,
 *   or undefined when the line is not complete yet.
 */
function findLineEnd(text) {
  const end = text.search(/[\r\n]/);
  if (end === -1) {
    return undefined;
  }
  if (text[end] === '\n') {
    return { end, next: end + 1 };
  }
  // A carriage return at the very end may be the first half of \r\n, so wait for more text.
  if (end === text.length - 1) {
    return undefined;
  }
  return { end, next: text[end + 1] === '\n' ? end + 2 : end + 1 };
}

/**
 * Creates a parser. It follows the Server-Sent Events format: `event:` and `data:` lines, several
 * `data:` lines joined by a line break, a blank line ending an event, and lines starting with a
 * colon ignored. `id:` and `retry:` are not used here.
 * @returns {SseParser} The parser.
 */
export function createSseParser() {
  let buffer = '';
  let event = DEFAULT_EVENT;
  /** @type {string[]} */
  let data = [];

  /**
   * Handles one complete line.
   * @param {string} line - The line, without its ending.
   * @returns {SseMessage | undefined} The event this line completed, if it did.
   */
  function readLine(line) {
    if (line === '') {
      const message = data.length > 0 ? { event, data: data.join('\n') } : undefined;
      event = DEFAULT_EVENT;
      data = [];
      return message;
    }
    if (line.startsWith(':')) {
      return undefined;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const rest = colon === -1 ? '' : line.slice(colon + 1);
    const value = rest.startsWith(' ') ? rest.slice(1) : rest;
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
    return undefined;
  }

  return {
    push(chunk) {
      buffer += chunk;
      /** @type {SseMessage[]} */
      const messages = [];
      for (let line = findLineEnd(buffer); line !== undefined; line = findLineEnd(buffer)) {
        const message = readLine(buffer.slice(0, line.end));
        buffer = buffer.slice(line.next);
        if (message !== undefined) {
          messages.push(message);
        }
      }
      return messages;
    },
  };
}
