// @ts-check

/**
 * Seconds a typical answer takes at the least, shown beside Stop while a question runs. This is
 * the 25th percentile of the time to an answer in the latest full run, `20261014-190623` (the 38
 * cases, asked as conversations, on `gpt-6-luna`): 59.3 s, rounded to the nearest 10 seconds.
 * Update it when a newer full run is logged in docs/EVAL_LOG.md.
 */
export const TYPICAL_SECONDS_LOW = 60;

/**
 * Seconds a typical answer takes at the most: the 75th percentile of the same run, 176.5 s,
 * rounded to the nearest 10 seconds.
 */
export const TYPICAL_SECONDS_HIGH = 180;
