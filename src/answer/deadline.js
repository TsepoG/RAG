// @ts-check
import { finishesWithin } from '../copilot/index.js';
import { AskTimeoutError, QuestionCancelledError } from '../errors/index.js';

/** Longest the cleanup after a question may take, so a stuck runtime cannot hang the caller. */
export const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Starts the clock for a question. When it runs out, the returned promise rejects.
 * @param {number} limitMs - The time limit in milliseconds.
 * @returns {{ promise: Promise<never>, cancel: () => void }} The deadline and a way to stop it.
 */
export function createDeadline(limitMs) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const promise = /** @type {Promise<never>} */ (
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AskTimeoutError(limitMs)), limitMs);
      // A pending deadline must not keep the process alive at exit.
      timer.unref();
    })
  );
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Watches for the person asking to stop the question. When the signal is aborted, the returned
 * promise rejects; if it is already aborted, it is rejected at once. Without a signal it never
 * settles.
 * @param {AbortSignal | undefined} signal - The signal that stops the question, if any.
 * @returns {{ promise: Promise<never>, cancel: () => void }} The watcher and a way to stop it.
 */
export function createCancellation(signal) {
  /** @type {(() => void) | undefined} */
  let onAbort;
  const promise = /** @type {Promise<never>} */ (
    new Promise((_, reject) => {
      if (signal === undefined) {
        return;
      }
      onAbort = () => reject(new QuestionCancelledError());
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    })
  );
  // Raced by the callers; marked as handled so a stop that nobody is waiting for is not "unhandled".
  promise.catch(() => undefined);
  return {
    promise,
    cancel() {
      if (signal !== undefined && onAbort !== undefined) {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/**
 * Runs a cleanup step without letting it fail or hang the question. Cleanup trouble is logged: the
 * answer, or the error that is already on its way, matters more than a tidy shutdown.
 * @param {string} what - What is being done, for the log.
 * @param {() => Promise<unknown>} step - The step.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} logger - Where problems are logged.
 * @returns {Promise<void>} Resolves when the step is done, failed or out of time.
 */
export async function bestEffort(what, step, logger) {
  const attempt = step().catch((error) => {
    logger.warn({ err: error }, `could not ${what}`);
  });
  if (!(await finishesWithin(attempt, SHUTDOWN_TIMEOUT_MS))) {
    logger.warn({}, `gave up waiting to ${what}`);
  }
}
