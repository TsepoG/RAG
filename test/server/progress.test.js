// @ts-check
import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '../../src/mcp/index.js';
import { toolEventToProgress } from '../../src/server/progress.js';

const ROLE = { displayName: 'Product Owner' };

/**
 * A tool activity.
 * @param {string} name - The bare tool name.
 * @param {string} [server] - The server key.
 * @returns {import('../../src/answer/askQuestion.js').Activity} The activity.
 */
function tool(name, server = 'atlassian') {
  return { kind: 'tool', server, tool: name };
}

describe('toolEventToProgress', () => {
  it.each([
    ['searchConfluence', 'Searching Confluence…'],
    ['getConfluenceContent', 'Opening a Confluence page…'],
    ['search_code', 'Searching the code…'],
    ['get_file_contents', 'Reading a file from GitHub…'],
    ['get_commit', 'Checking a recent change…'],
    ['list_commits', 'Checking recent changes…'],
    ['list_releases', 'Checking releases…'],
    ['get_latest_release', 'Checking the latest release…'],
  ])('describes %s as "%s"', (name, message) => {
    expect(toolEventToProgress(tool(name), ROLE)).toBe(message);
  });

  it('says it is checking the answer once the model has replied', () => {
    expect(toolEventToProgress({ kind: 'checking' }, ROLE)).toBe('Checking the answer…');
  });

  it('names the role when it rewrites the answer', () => {
    expect(toolEventToProgress({ kind: 'rewriting' }, ROLE)).toBe(
      'Rewriting the answer for a Product Owner…',
    );
  });

  it('uses a general line for a tool it has no wording for', () => {
    expect(toolEventToProgress(tool('view', 'unknown'), ROLE)).toBe('Looking something up…');
  });

  it('does not take a name from the prototype chain as a tool', () => {
    expect(toolEventToProgress(tool('constructor'), ROLE)).toBe('Looking something up…');
  });

  it('has wording for every tool on the allow-list, so none falls back to the general line', () => {
    const general = toolEventToProgress(tool('not-a-tool'), ROLE);
    const tools = Object.entries(ALLOWLIST).flatMap(([server, names]) =>
      names.map((name) => ({ server, name })),
    );

    for (const { server, name } of tools) {
      expect(toolEventToProgress(tool(name, server), ROLE), `${server} ${name}`).not.toBe(general);
    }
  });
});
