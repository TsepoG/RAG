// @ts-check
import { readFileSync } from 'node:fs';

export const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
export const BLOB_SHA = '57f682c9d938c83e89b36d164d53cfd37a5d7893';
const NOW = Date.parse('2026-10-11T00:00:00Z');

/**
 * A context for extractors with a fixed clock and a resolver that always finds the same commit.
 * @param {Partial<import('../../src/citations/extractors/index.js').ExtractContext>} [overrides] - Changes.
 * @returns {import('../../src/citations/extractors/index.js').ExtractContext} The context.
 */
export function makeContext(overrides = {}) {
  return {
    siteUrl: 'https://acme.atlassian.net',
    spaceKeys: ['ENG', 'PROD'],
    repos: ['acme/app'],
    now: () => NOW,
    resolveHead: async () => HEAD_SHA,
    ...overrides,
  };
}

/**
 * Reads a sanitised fixture.
 * @param {string} name - File name without extension, from test/fixtures/mcp.
 * @returns {{ arguments: Record<string, unknown>, result: { content: Array<Record<string, any>> } }} The fixture.
 */
export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/mcp/${name}.json`, import.meta.url), 'utf8'));
}

/**
 * Builds extractor input from a fixture the way the post-tool hook would: the model's text is the
 * text content joined, and a file's resource URI is in the log.
 * @param {string} name - Fixture name.
 * @param {Record<string, unknown>} [args] - Arguments to use instead of the fixture's.
 * @returns {import('../../src/citations/extractors/index.js').ExtractInput} The input.
 */
export function fixtureInput(name, args) {
  const fixture = loadFixture(name);
  const blocks = fixture.result.content;
  const text = blocks.map((block) => block.text ?? block.resource?.text ?? '').join('');
  const uris = blocks.map((block) => block.resource?.uri).filter(Boolean);
  return {
    args: args ?? fixture.arguments,
    text,
    ...(uris.length === 0 ? {} : { log: `${uris.join('\n')}\n${text}` }),
  };
}
