// @ts-check
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { connectMcp, MCP_FACTORIES } from '../../src/mcp/connect.js';

describe('connectMcp', () => {
  it('connects a client over HTTP with the headers and the time limit', async () => {
    const connect = vi.fn(async () => undefined);
    const client = /** @type {Client} */ (/** @type {unknown} */ ({ connect }));
    /** @type {Array<[URL, RequestInit]>} */
    const transports = [];
    const transport = /** @type {StreamableHTTPClientTransport} */ (
      /** @type {unknown} */ ({ kind: 'transport' })
    );

    const connected = await connectMcp(
      {
        url: 'https://mcp.example/v2/mcp',
        headers: { Authorization: 'Bearer fake' },
        timeout: 500,
      },
      {
        createClient: () => client,
        createTransport: (url, init) => {
          transports.push([url, init]);
          return transport;
        },
      },
    );

    expect(connected).toBe(client);
    expect(transports).toEqual([
      [new URL('https://mcp.example/v2/mcp'), { headers: { Authorization: 'Bearer fake' } }],
    ]);
    expect(connect).toHaveBeenCalledWith(transport, { timeout: 500 });
  });
});

describe('MCP_FACTORIES', () => {
  it('makes a real client and an HTTP transport without connecting', () => {
    expect(MCP_FACTORIES.createClient()).toBeInstanceOf(Client);
    expect(
      MCP_FACTORIES.createTransport(new URL('https://mcp.example/v2/mcp'), { headers: {} }),
    ).toBeInstanceOf(StreamableHTTPClientTransport);
  });
});
