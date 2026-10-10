// @ts-check

/**
 * Collects pino output in memory so tests can inspect what was logged.
 * @returns {{ stream: { write(message: string): void }, lines: () => Array<Record<string, unknown>> }}
 *   A destination to hand to the logger and an accessor for the parsed JSON lines written so far.
 */
export function createMemoryStream() {
  /** @type {string[]} */
  const chunks = [];
  return {
    stream: {
      write(message) {
        chunks.push(message);
      },
    },
    lines: () => chunks.map((chunk) => JSON.parse(chunk)),
  };
}
