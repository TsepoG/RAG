// @ts-check
import { describe, expect, it } from 'vitest';
import {
  authorizationServerMetadataUrl,
  parseAuthorizationServer,
  parseProtectedResource,
  protectedResourceMetadataUrl,
} from '../../src/atlassian/discovery.js';
import { AtlassianAuthError } from '../../src/errors/index.js';

const RESOURCE = 'https://mcp.atlassian.com/v2/mcp';
const ISSUER = 'https://auth.atlassian.com/tenant-id';
const INSECURE = 'http';

/** Protected-resource metadata shaped like Atlassian's. */
const RESOURCE_METADATA = Object.freeze({
  resource: RESOURCE,
  authorization_servers: [ISSUER],
  bearer_methods_supported: ['header'],
});

/** Authorization server metadata shaped like Atlassian's. */
const SERVER_METADATA = Object.freeze({
  issuer: ISSUER,
  authorization_endpoint: 'https://auth.atlassian.com/authorize',
  token_endpoint: 'https://auth.atlassian.com/oauth/token',
  revocation_endpoint: 'https://auth.atlassian.com/oauth/revoke',
  registration_endpoint: `${ISSUER}/dcr/register`,
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
});

/**
 * Runs a parser and returns the error it throws.
 * @param {() => unknown} parse - The parse to run.
 * @returns {AtlassianAuthError} The error.
 */
function failureOf(parse) {
  try {
    parse();
  } catch (error) {
    if (error instanceof AtlassianAuthError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the metadata to be refused');
}

describe('metadata addresses', () => {
  it('puts the well-known path between the origin and the path', () => {
    expect(protectedResourceMetadataUrl(RESOURCE)).toBe(
      'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp',
    );
    expect(authorizationServerMetadataUrl(ISSUER)).toBe(
      'https://auth.atlassian.com/.well-known/oauth-authorization-server/tenant-id',
    );
  });

  it('drops trailing slashes and handles a URL without a path', () => {
    expect(authorizationServerMetadataUrl(`${ISSUER}//`)).toBe(
      'https://auth.atlassian.com/.well-known/oauth-authorization-server/tenant-id',
    );
    expect(authorizationServerMetadataUrl('https://auth.example')).toBe(
      'https://auth.example/.well-known/oauth-authorization-server',
    );
  });
});

describe('parseProtectedResource', () => {
  it('returns the first authorization server', () => {
    expect(parseProtectedResource(RESOURCE_METADATA, RESOURCE)).toBe(ISSUER);
  });

  it('refuses metadata for another resource', () => {
    const error = failureOf(() =>
      parseProtectedResource(
        { ...RESOURCE_METADATA, resource: 'https://evil.example/mcp' },
        RESOURCE,
      ),
    );

    expect(error.reason).toBe('failed');
    expect(error.message).toContain('resource');
    expect(error.message).not.toContain('evil.example');
  });

  it.each([
    ['no authorization server', { ...RESOURCE_METADATA, authorization_servers: [] }],
    [
      'an http authorization server',
      { ...RESOURCE_METADATA, authorization_servers: [`${INSECURE}://auth.example`] },
    ],
    ['a body that is not an object', 'not json'],
  ])('refuses metadata with %s', (_label, body) => {
    expect(() => parseProtectedResource(body, RESOURCE)).toThrow(AtlassianAuthError);
  });
});

describe('parseAuthorizationServer', () => {
  it('returns the endpoints the app needs', () => {
    expect(parseAuthorizationServer(SERVER_METADATA, ISSUER)).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: 'https://auth.atlassian.com/authorize',
      tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
      revocationEndpoint: 'https://auth.atlassian.com/oauth/revoke',
      registrationEndpoint: `${ISSUER}/dcr/register`,
      issParameterSupported: false,
    });
  });

  it('says when the callback carries an issuer to check', () => {
    const server = parseAuthorizationServer(
      { ...SERVER_METADATA, authorization_response_iss_parameter_supported: true },
      ISSUER,
    );

    expect(server.issParameterSupported).toBe(true);
  });

  it.each([
    'authorization_endpoint',
    'token_endpoint',
    'revocation_endpoint',
    'registration_endpoint',
  ])('refuses metadata without %s, naming it', (field) => {
    const error = failureOf(() =>
      parseAuthorizationServer({ ...SERVER_METADATA, [field]: undefined }, ISSUER),
    );

    expect(error.message).toContain(field);
  });

  it('refuses an endpoint that is not https', () => {
    const error = failureOf(() =>
      parseAuthorizationServer(
        { ...SERVER_METADATA, token_endpoint: `${INSECURE}://auth.atlassian.com/oauth/token` },
        ISSUER,
      ),
    );

    expect(error.message).toContain('token_endpoint: must be an https URL');
    expect(error.message).not.toContain(`${INSECURE}://`);
  });

  it('refuses a server that does not support S256', () => {
    const error = failureOf(() =>
      parseAuthorizationServer(
        { ...SERVER_METADATA, code_challenge_methods_supported: ['plain'] },
        ISSUER,
      ),
    );

    expect(error.message).toContain('must include S256');
  });

  it('refuses metadata that names another issuer', () => {
    const error = failureOf(() =>
      parseAuthorizationServer(
        { ...SERVER_METADATA, issuer: 'https://auth.atlassian.com/other' },
        ISSUER,
      ),
    );

    expect(error.message).toContain('issuer');
  });

  it('names the body when it is not an object', () => {
    expect(failureOf(() => parseAuthorizationServer(null, ISSUER)).message).toContain('body:');
  });
});
