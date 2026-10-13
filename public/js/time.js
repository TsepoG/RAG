// @ts-check

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * Says how long ago something happened, in a few words that stay true for a while.
 * @param {number} now - The time now, in ms.
 * @param {number} then - When it happened, in ms.
 * @returns {string} For example "just now", "1 min ago", "3 h ago" or "2 days ago".
 */
export function agoText(now, then) {
  const minutes = Math.floor(Math.max(0, now - then) / MS_PER_MINUTE);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
