// @ts-check
import { describe, expect, it } from 'vitest';
import { AppError, ToolNotAllowedError } from '../../src/errors/index.js';
import {
  checkSample,
  parseSampleArgs,
  RAW_DIRECTORY,
  rawSamplePath,
  SAMPLE_USAGE,
} from '../../src/mcp/sample.js';

const LIMITS = {
  repos: ['acme/app'],
  spaceKeys: ['ENG'],
  siteUrl: 'https://acme.atlassian.net',
};

/**
 * Runs a function that should fail and returns the error.
 * @param {() => unknown} work - The function.
 * @returns {any} What it threw.
 */
function thrown(work) {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseSampleArgs', () => {
  it('reads the tool and its JSON arguments, naming the file after the tool', () => {
    expect(parseSampleArgs(['get_commit', '{"owner":"acme","repo":"app"}'])).toEqual({
      tool: 'get_commit',
      args: { owner: 'acme', repo: 'app' },
      name: 'get_commit',
    });
  });

  it('uses the name given with --as, wherever the flag sits', () => {
    const after = parseSampleArgs(['get_file_contents', '{}', '--as', 'get_file_contents_dir']);
    const before = parseSampleArgs(['--as', 'get_file_contents_dir', 'get_file_contents', '{}']);

    expect(after.name).toBe('get_file_contents_dir');
    expect(before).toEqual(after);
  });

  it.each([[[]], [['get_commit']], [['get_commit', '{}', 'extra']]])(
    'shows the usage for the arguments %j',
    (argv) => {
      const error = thrown(() => parseSampleArgs(argv));

      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe(SAMPLE_USAGE);
    },
  );

  it.each([
    [['get_commit', '{}', '--as']],
    [['get_commit', '{}', '--as', '../escape']],
    [['get_commit', '{}', '--as', 'a b']],
  ])('rejects a missing or unsafe --as name in %j', (argv) => {
    const error = thrown(() => parseSampleArgs(argv));

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toContain('--as needs a file name');
  });

  it('rejects arguments that are not JSON, keeping the cause', () => {
    const error = thrown(() => parseSampleArgs(['get_commit', '{owner: acme}']));

    expect(error.message).toContain('not valid JSON');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each(['[1]', '"text"', '42', 'null'])('rejects JSON that is not an object: %s', (json) => {
    expect(thrown(() => parseSampleArgs(['get_commit', json])).message).toContain(
      'must be a JSON object',
    );
  });
});

describe('checkSample', () => {
  it('accepts an allow-listed tool inside the configured scope', () => {
    const request = {
      tool: 'get_commit',
      args: { owner: 'acme', repo: 'app', sha: 'abc' },
      name: 'x',
    };

    expect(checkSample(request, LIMITS)).toEqual({ server: 'github_repos', tool: 'get_commit' });
  });

  it('accepts a Confluence search inside a configured space', () => {
    const request = {
      tool: 'searchConfluence',
      args: { cloudId: 'id', cql: 'space = ENG AND text ~ "refund"' },
      name: 'x',
    };

    expect(checkSample(request, LIMITS)).toEqual({ server: 'atlassian', tool: 'searchConfluence' });
  });

  it.each(['create_pull_request', 'push_files', 'executeWrite', 'search', 'nonsense'])(
    'refuses the tool %s, which is not on the allow-list',
    (tool) => {
      const error = thrown(() => checkSample({ tool, args: {}, name: tool }, LIMITS));

      expect(error).toBeInstanceOf(ToolNotAllowedError);
    },
  );

  it('refuses a repository that is not configured', () => {
    const request = {
      tool: 'get_commit',
      args: { owner: 'evil', repo: 'secrets', sha: 'a' },
      name: 'x',
    };

    const error = thrown(() => checkSample(request, LIMITS));

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toMatch(/^Refused: /);
  });

  it('refuses a Confluence query outside the configured spaces', () => {
    const request = {
      tool: 'searchConfluence',
      args: { cloudId: 'id', cql: 'space = HR AND text ~ "salary"' },
      name: 'x',
    };

    expect(thrown(() => checkSample(request, LIMITS))).toBeInstanceOf(AppError);
  });

  it('refuses a page URL on another site', () => {
    const request = {
      tool: 'getConfluenceContent',
      args: { cloudId: 'id', content_url: 'https://evil.atlassian.net/wiki/spaces/ENG/pages/1' },
      name: 'x',
    };

    expect(thrown(() => checkSample(request, LIMITS))).toBeInstanceOf(AppError);
  });
});

describe('rawSamplePath', () => {
  it('places the sample under the git-ignored raw directory', () => {
    expect(RAW_DIRECTORY).toBe('test/fixtures/raw');
    expect(rawSamplePath('get_commit')).toBe('test/fixtures/raw/get_commit.json');
  });
});
