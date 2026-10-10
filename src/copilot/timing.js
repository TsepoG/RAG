// @ts-check

/**
 * Waits for a promise, but no longer than a limit. The work is not cancelled when the limit runs
 * out; it simply stops being waited for.
 * @param {Promise<unknown>} work - The work to wait for.
 * @param {number} limitMs - Longest wait in milliseconds.
 * @returns {Promise<boolean>} True if the work finished in time, false if the wait timed out.
 */
export async function finishesWithin(work, limitMs) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, limitMs, false);
    // A timer that is still pending must not keep the process alive at exit.
    timer.unref();
  });
  try {
    return (await Promise.race([work.then(() => true), timeout])) === true;
  } finally {
    clearTimeout(timer);
  }
}
