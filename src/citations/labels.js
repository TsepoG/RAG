// @ts-check

const SHORT_SHA_LENGTH = 7;
const CAMEL_BOUNDARY = /([a-z\d])([A-Z])/g;
const WORD_SEPARATORS = /[-_.\s]+/;
const ACRONYM = /^[A-Z\d]+$/;

/**
 * Turns a file name into plain words: `refund_policy.ts` becomes "Refund policy".
 * @param {string} path - A file path.
 * @returns {string} A readable name.
 */
function humaniseFileName(path) {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const words = stem
    .replace(CAMEL_BOUNDARY, '$1 $2')
    .split(WORD_SEPARATORS)
    .filter((word) => word !== '')
    .map((word) => (ACRONYM.test(word) ? word : word.toLowerCase()));
  const [first = fileName, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * Names a source in business terms, for roles whose answers do not show file paths.
 * Confluence: "Refund Policy v3 — Confluence (PAY)". GitHub: "Refund policy — code (payments)".
 * @param {import('./registry.js').Source} source - The source.
 * @returns {string} The label.
 */
export function friendlyLabel(source) {
  if (source.type === 'confluence') {
    return `${source.title} v${source.version} — Confluence (${source.spaceKey})`;
  }
  const repoName = source.repo.slice(source.repo.indexOf('/') + 1);
  if (source.kind === 'commit') {
    return `Commit ${source.commitSha.slice(0, SHORT_SHA_LENGTH)} — code (${repoName})`;
  }
  if (source.kind === 'release') {
    return `Release ${source.title} — code (${repoName})`;
  }
  if (source.kind === 'directory') {
    const name = source.path === '' ? 'Top-level' : humaniseFileName(source.path);
    return `${name} folder — code (${repoName})`;
  }
  return `${humaniseFileName(source.path)} — code (${repoName})`;
}
