// @ts-check
import { describe, expect, it } from 'vitest';
import {
  classifyTool,
  findWriteVerb,
  isWriteToolName,
  LEADING_ONLY_WRITE_VERBS,
  toolNameWords,
  WRITE_VERBS,
} from '../../src/mcp/classify.js';

/**
 * Turns a verb into a camelCase tool name such as `createPage`.
 * @param {string} verb - Write verb.
 * @returns {string} A camelCase name starting with the verb.
 */
const camel = (verb) => `${verb}ConfluencePage`;

/**
 * Turns a verb into a snake_case tool name such as `create_page`.
 * @param {string} verb - Write verb.
 * @returns {string} A snake_case name starting with the verb.
 */
const snake = (verb) => `${verb}_file_contents`;

describe('toolNameWords', () => {
  it.each([
    ['getConfluenceContent', ['get', 'confluence', 'content']],
    ['get_file_contents', ['get', 'file', 'contents']],
    ['list-commits', ['list', 'commits']],
    ['searchCQL', ['search', 'cql']],
    ['search', ['search']],
    ['__get__x__', ['get', 'x']],
  ])('splits %s into words', (name, words) => {
    expect(toolNameWords(name)).toEqual(words);
  });
});

describe('isWriteToolName', () => {
  it.each(WRITE_VERBS)('flags %s as a write verb in camelCase and snake_case', (verb) => {
    expect(isWriteToolName(camel(verb))).toBe(true);
    expect(isWriteToolName(snake(verb))).toBe(true);
  });

  it.each(LEADING_ONLY_WRITE_VERBS)('flags %s only at the start of a name', (verb) => {
    expect(isWriteToolName(`${verb}_copilot_review`)).toBe(true);
    expect(isWriteToolName(`get_pull_${verb}`)).toBe(false);
  });

  it.each([
    'issue_write',
    'sub_issue_write',
    'create_or_update_file',
    'push_files',
    'merge_pull_request',
    'fork_repository',
    'addCommentToPage',
    'createConfluenceFooterComment',
  ])('flags the write tool %s wherever the verb sits', (name) => {
    expect(isWriteToolName(name)).toBe(true);
  });

  it.each([
    'search',
    'searchConfluence',
    'getConfluenceContent',
    'listConfluenceContent',
    'listConfluenceSpaces',
    'getConfluenceSpace',
    'listConfluenceContentVersions',
    'getConfluenceContentVersion',
    'getAccessibleAtlassianResources',
    'get_file_contents',
    'get_commit',
    'list_commits',
    'list_branches',
    'list_tags',
    'get_tag',
    'search_code',
    'search_repositories',
    'get_latest_release',
    'get_pull_request',
  ])('does not flag the read tool %s', (name) => {
    expect(isWriteToolName(name)).toBe(false);
  });

  it('matches whole words, not fragments', () => {
    expect(isWriteToolName('getRunbook')).toBe(false);
    expect(isWriteToolName('list_starred_repositories')).toBe(false);
    expect(isWriteToolName('getSettings')).toBe(false);
  });
});

describe('findWriteVerb', () => {
  it('returns the first write verb in the name', () => {
    expect(findWriteVerb('issue_write')).toBe('write');
    expect(findWriteVerb('create_or_update_file')).toBe('create');
  });

  it('returns undefined for a read name', () => {
    expect(findWriteVerb('get_file_contents')).toBeUndefined();
  });
});

describe('classifyTool', () => {
  it('classifies a read-looking tool with no annotations as read', () => {
    expect(classifyTool({ name: 'get_file_contents' })).toEqual({
      kind: 'read',
      reason: 'no write verb in the name',
    });
  });

  it('classifies a tool the server marks read-only as read', () => {
    const tool = { name: 'search', annotations: { readOnlyHint: true } };

    expect(classifyTool(tool).kind).toBe('read');
  });

  it('classifies a write-named tool as write and says which verb', () => {
    expect(classifyTool({ name: 'createConfluencePage' })).toEqual({
      kind: 'write',
      reason: 'name contains the write verb "create"',
    });
  });

  it('keeps a write-named tool as write even if the server calls it read-only', () => {
    const tool = { name: 'delete_file', annotations: { readOnlyHint: true } };

    expect(classifyTool(tool).kind).toBe('write');
  });

  it('classifies a read-named tool the server marks destructive as write', () => {
    const tool = { name: 'get_things', annotations: { destructiveHint: true } };

    expect(classifyTool(tool)).toEqual({ kind: 'write', reason: 'server marks it destructive' });
  });

  it('classifies a read-named tool the server says is not read-only as write', () => {
    const tool = { name: 'get_things', annotations: { readOnlyHint: false } };

    expect(classifyTool(tool)).toEqual({
      kind: 'write',
      reason: 'server does not mark it read-only',
    });
  });

  it('ignores annotations that say nothing either way', () => {
    const tool = { name: 'get_things', annotations: { destructiveHint: false } };

    expect(classifyTool(tool).kind).toBe('read');
  });
});
