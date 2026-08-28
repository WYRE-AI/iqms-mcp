/**
 * Exercises createServer()'s CallToolRequestSchema handler end-to-end over a
 * real (in-memory) MCP transport — the navigate/status special-casing, the
 * domain-routing loop, and the try/catch that maps a thrown domain-handler
 * error into an isError CallToolResult. None of this request-dispatch logic
 * was previously invoked by any test; only the underlying tool lists
 * (getNavigationTools / getDomainHandler().getTools()) were checked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';
import { getClient, getCredentials } from '../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../src/utils/client.js', () => ({
  getClient: vi.fn(),
  getCredentials: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);
const mockedGetCredentials = vi.mocked(getCredentials);

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('server dispatch', () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    mockedGetClient.mockReset();
    mockedGetCredentials.mockReset();
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it('lists tools from navigation plus every domain', async () => {
    ({ client, server } = await connectedClient());

    const { tools } = await client.listTools();

    const names = tools.map((t) => t.name);
    expect(names).toContain('iqms_navigate');
    expect(names).toContain('iqms_status');
    expect(names).toContain('iqms_boms_explode');
    expect(names).toContain('iqms_workorders_list');
    expect(new Set(names).size).toBe(names.length);
  });

  describe('iqms_navigate', () => {
    it('returns the tool list for a valid domain', async () => {
      ({ client, server } = await connectedClient());

      const result = await client.callTool({
        name: 'iqms_navigate',
        arguments: { domain: 'boms' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Domain: boms');
      expect(text).toContain('iqms_boms_explode');
      expect(text).toContain('iqms_boms_where_used');
    });

    it('returns isError for an invalid domain', async () => {
      ({ client, server } = await connectedClient());

      const result = await client.callTool({
        name: 'iqms_navigate',
        arguments: { domain: 'not_a_real_domain' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Invalid domain: not_a_real_domain');
    });
  });

  describe('iqms_status', () => {
    it('reports oracleConnected=false / webapiEnabled=false when no credentials are configured', async () => {
      mockedGetCredentials.mockReturnValue(null);
      ({ client, server } = await connectedClient());

      const result = await client.callTool({ name: 'iqms_status', arguments: {} });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toMatchObject({ oracleConnected: false, webapiEnabled: false });
    });

    it('reports oracleConnected=true / webapiEnabled=true when full credentials are configured', async () => {
      mockedGetCredentials.mockReturnValue({
        oracle: { user: 'u', password: 'p', connectString: 'host:1521/EIQ' },
        webapi: { baseUrl: 'http://eiq', username: 'svc', password: 'pw' },
      });
      ({ client, server } = await connectedClient());

      const result = await client.callTool({ name: 'iqms_status', arguments: {} });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toMatchObject({ oracleConnected: true, webapiEnabled: true });
    });
  });

  it('routes a domain tool call through to the matching handler and returns its mapped result', async () => {
    const explode = vi.fn().mockResolvedValue([{ parentItem: 'WIDGET-1', componentItem: 'SCREW-2' }]);
    mockedGetClient.mockResolvedValue({
      boms: { explode, whereUsed: vi.fn() },
    } as unknown as IqmsClient);
    ({ client, server } = await connectedClient());

    const result = await client.callTool({
      name: 'iqms_boms_explode',
      arguments: { parent_item: 'WIDGET-1' },
    });

    expect(explode).toHaveBeenCalledWith({ parentItem: 'WIDGET-1', maxLevel: undefined });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual([{ parentItem: 'WIDGET-1', componentItem: 'SCREW-2' }]);
  });

  it('catches a thrown domain-handler error and maps it to an isError result instead of rejecting', async () => {
    const explode = vi.fn().mockRejectedValue(new Error('ORA-00001: unique constraint violated'));
    mockedGetClient.mockResolvedValue({
      boms: { explode, whereUsed: vi.fn() },
    } as unknown as IqmsClient);
    ({ client, server } = await connectedClient());

    const result = await client.callTool({
      name: 'iqms_boms_explode',
      arguments: { parent_item: 'WIDGET-1' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toBe('Error: ORA-00001: unique constraint violated');
  });

  it('returns isError with a discovery hint for a completely unknown tool name', async () => {
    ({ client, server } = await connectedClient());

    const result = await client.callTool({ name: 'not_a_real_tool', arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Unknown tool: not_a_real_tool');
    expect(text).toContain('iqms_navigate');
  });
});
