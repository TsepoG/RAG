// @ts-check
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRefs } from '../../public/js/refs.js';

// Vitest runs from the project root. `new URL(..., import.meta.url)` is not used because happy-dom
// replaces the URL class.
const PAGE_PATH = resolve('public/index.html');

/** The page's own HTML, read from `public/index.html`, so tests run against the real markup. */
export const PAGE_HTML = readFileSync(PAGE_PATH, 'utf8');

/**
 * Puts the real page in the test document and finds its elements.
 * @returns {import('../../public/js/refs.js').PageRefs} The page's elements.
 */
export function loadPage() {
  // Only the body is used, so the test document does not try to load the stylesheet and script.
  const start = PAGE_HTML.indexOf('<body>') + '<body>'.length;
  document.body.innerHTML = PAGE_HTML.slice(start, PAGE_HTML.indexOf('</body>'));
  return findRefs();
}

/**
 * A citation chip as the server writes it.
 * @param {string} key - The key, such as C1.
 * @param {boolean} [inferred] - Whether it carries the asterisk.
 * @returns {string} The HTML.
 */
export function chip(key, inferred = false) {
  const label = inferred ? `${key}*` : key;
  return `<button type="button" class="cite" data-key="${key}" data-inferred="${inferred}">${label}</button>`;
}

/**
 * What the server sends for a finished question, with the parts a test may change.
 * @param {Record<string, any>} [changes] - Parts to change, merged one level deep.
 * @returns {import('../../public/js/state.js').DonePayload} The payload.
 */
export function makePayload(changes = {}) {
  /** @type {Record<string, any>} */
  const payload = {
    answerId: 'a1',
    result: {
      status: 'answered',
      confidence: 'medium',
      confidenceReason: 'Part of this is my reading.',
      detailLevel: 'default',
      sources: [
        {
          key: 'C1',
          type: 'confluence',
          title: 'Refund Policy',
          friendlyLabel: 'Refund Policy v3 — Confluence (PAY)',
          url: 'https://acme.atlassian.net/wiki/spaces/PAY/pages/1',
          stale: true,
          inferred: false,
        },
        {
          key: 'G1',
          type: 'github',
          kind: 'file',
          path: 'src/refund.js',
          title: 'src/refund.js',
          friendlyLabel: 'Refund — code (app)',
          commitSha: '9c1e2ab4f0d1',
          url: 'https://github.com/acme/app/blob/9c1e2ab4f0d1/src/refund.js',
          inferred: true,
        },
      ],
      alsoConsulted: [
        { title: 'Returns FAQ', url: 'https://acme.atlassian.net/wiki/spaces/PAY/pages/2' },
      ],
    },
    rendered: {
      level: 'medium',
      banner: 'Mostly confirmed. Part of this is my reading.',
      text: 'Refunds are allowed for 30 days [C1].',
      conflicts: [],
      gaps: ['The refund window for gift cards'],
      closestPages: [],
      whoToAsk: [{ name: '@acme/payments', sourceKeys: ['G1'] }],
    },
    html: { answer: `<p>Refunds are allowed for 30 days ${chip('C1')}.</p>`, conflicts: [] },
  };
  for (const [part, value] of Object.entries(changes)) {
    payload[part] =
      typeof value === 'object' && !Array.isArray(value) ? { ...payload[part], ...value } : value;
  }
  return /** @type {any} */ (payload);
}
