// @ts-check
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { buildSessionConfig, CLIENT_NAME, EXCLUDED_TOOLS } from '../../src/copilot/session.js';
import { buildSystemMessage } from '../../src/copilot/systemMessage.js';
import { ALLOWLIST, buildMcpServers, toAvailableTools } from '../../src/mcp/index.js';
import {
  FAKE_ATLASSIAN_TOKEN,
  FAKE_COPILOT_TOKEN,
  FAKE_GITHUB_TOKEN,
  validEnv,
} from '../helpers/env.js';
import { makeRole, TEST_ROLE } from '../helpers/role.js';

const WORKING_DIRECTORY = 'sandbox/work';
const HOOKS = { onPreToolUse: () => ({ permissionDecision: /** @type {const} */ ('allow') }) };
const PERMISSION_HANDLER = () => ({ kind: /** @type {const} */ ('reject') });

/**
 * Builds a session config from a fixture environment.
 * @param {Record<string, string | undefined>} [overrides] - Environment overrides.
 * @param {import('../../src/roles/index.js').Role} [role] - The role.
 * @returns {ReturnType<typeof buildSessionConfig>} The session config.
 */
function build(overrides = {}, role = TEST_ROLE) {
  return buildSessionConfig({
    config: loadConfig(validEnv(overrides)),
    role,
    workingDirectory: WORKING_DIRECTORY,
    hooks: HOOKS,
    onPermissionRequest: PERMISSION_HANDLER,
  });
}

describe('buildSessionConfig model', () => {
  it('leaves the model out when none is configured, so the account default applies', () => {
    expect(build()).not.toHaveProperty('model');
  });

  it('uses the configured model', () => {
    expect(build({ COPILOT_MODEL: 'gpt-x' }).model).toBe('gpt-x');
  });
});

describe('buildSessionConfig prompt and streaming', () => {
  it('streams the answer', () => {
    expect(build().streaming).toBe(true);
  });

  it('appends the system message instead of replacing the SDK prompt and its guardrails', () => {
    const { systemMessage } = build();

    expect(systemMessage).toEqual({
      mode: 'append',
      content: buildSystemMessage({
        role: TEST_ROLE,
        spaceKeys: ['ENG', 'PROD'],
        repos: ['acme/app', 'acme/docs'],
        siteUrl: 'https://acme.atlassian.net',
      }),
    });
  });

  it('puts the configured cloudId in the system message', () => {
    const cloudId = '82b58a78-f056-49aa-a740-c3c946f68f8b';

    const content = build({ ATLASSIAN_CLOUD_ID: cloudId }).systemMessage;

    expect(JSON.stringify(content)).toContain(`The cloudId of that site is ${cloudId}.`);
  });

  it('writes the system message for the role it is given', () => {
    const content = build({}, makeRole({ displayName: 'Auditor' })).systemMessage;

    expect(JSON.stringify(content)).toContain('This answer is for a Auditor.');
  });

  it('names the application', () => {
    expect(build().clientName).toBe(CLIENT_NAME);
    expect(CLIENT_NAME).toBe('role-aware-assistant');
  });

  it('puts no secret in the system message', () => {
    const message = JSON.stringify(
      build({ COPILOT_GITHUB_TOKEN: FAKE_COPILOT_TOKEN }).systemMessage,
    );

    expect(message).not.toContain(FAKE_GITHUB_TOKEN);
    expect(message).not.toContain(FAKE_ATLASSIAN_TOKEN);
    expect(message).not.toContain(FAKE_COPILOT_TOKEN);
  });
});

describe('buildSessionConfig tools', () => {
  it('registers the two MCP servers with the allow-lists', () => {
    const config = loadConfig(validEnv());

    expect(build().mcpServers).toEqual(buildMcpServers(config, ALLOWLIST));
  });

  it('makes exactly the nine allow-listed MCP tools available, by exact name', () => {
    const { availableTools } = build();

    expect(availableTools).toEqual(toAvailableTools());
    expect(availableTools).toHaveLength(9);
    expect(availableTools).toContain('mcp:atlassian-searchConfluence');
    expect(availableTools).toContain('mcp:github_repos-search_code');
  });

  it('uses no wildcard in the available tools', () => {
    expect(build().availableTools).not.toContainEqual(expect.stringContaining('*'));
  });

  it('excludes every built-in and custom tool, and exclusions win', () => {
    expect(build().excludedTools).toEqual(['builtin:*', 'custom:*']);
    expect(EXCLUDED_TOOLS).toEqual(['builtin:*', 'custom:*']);
  });

  it('gives each session its own copy of the exclusions', () => {
    // buildSessionConfig always returns a plain array; the SDK type also allows a ToolSet.
    const excludedTools = /** @type {string[]} */ (build().excludedTools);

    excludedTools.push('changed');

    expect(EXCLUDED_TOOLS).toEqual(['builtin:*', 'custom:*']);
  });

  it('defines no custom tools and no custom model provider', () => {
    const config = build();

    expect(config).not.toHaveProperty('tools');
    expect(config).not.toHaveProperty('provider');
    expect(config).not.toHaveProperty('customAgents');
  });
});

describe('buildSessionConfig sandbox', () => {
  it('runs in the working directory it is given', () => {
    expect(build().workingDirectory).toBe(WORKING_DIRECTORY);
  });

  it('does not let the runtime swap a long result for a temp file the model cannot read', () => {
    expect(build().largeOutput).toEqual({ enabled: false });
  });

  it('keeps no history, memory or discovered configuration', () => {
    const config = build();

    expect(config.infiniteSessions).toEqual({ enabled: false });
    expect(config.memory).toEqual({ enabled: false });
    expect(config.enableConfigDiscovery).toBe(false);
  });

  it.each(['enableSkills', 'enableFileHooks', 'enableHostGitOperations', 'enableSessionStore'])(
    'switches %s off',
    (option) => {
      expect(build()).toMatchObject({ [option]: false });
    },
  );
});

describe('buildSessionConfig hooks and permissions', () => {
  it('registers the hooks it is given', () => {
    expect(build().hooks).toBe(HOOKS);
  });

  it('registers the permission handler it is given', () => {
    expect(build().onPermissionRequest).toBe(PERMISSION_HANDLER);
  });
});
