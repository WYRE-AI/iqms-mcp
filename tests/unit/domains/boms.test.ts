import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bomsHandler } from '../../../src/domains/boms.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(boms: Partial<IqmsClient['boms']>) {
  mockedGetClient.mockResolvedValue({ boms } as unknown as IqmsClient);
}

describe('bomsHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_boms_explode', () => {
    it('maps snake_case args to camelCase client params', async () => {
      const explode = vi.fn().mockResolvedValue([]);
      mockClient({ explode, whereUsed: vi.fn() });

      await bomsHandler.handleCall('iqms_boms_explode', {
        parent_item: 'WIDGET-1',
        max_level: 3,
      });

      expect(explode).toHaveBeenCalledWith({ parentItem: 'WIDGET-1', maxLevel: 3 });
    });

    it('passes max_level through as undefined when omitted (client applies its own default)', async () => {
      const explode = vi.fn().mockResolvedValue([]);
      mockClient({ explode, whereUsed: vi.fn() });

      await bomsHandler.handleCall('iqms_boms_explode', { parent_item: 'WIDGET-1' });

      expect(explode).toHaveBeenCalledWith({ parentItem: 'WIDGET-1', maxLevel: undefined });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        { parentItem: 'WIDGET-1', componentItem: 'SCREW-2', quantityPer: 4, uom: 'EA' },
      ];
      const explode = vi.fn().mockResolvedValue(rows);
      mockClient({ explode, whereUsed: vi.fn() });

      const result = await bomsHandler.handleCall('iqms_boms_explode', {
        parent_item: 'WIDGET-1',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(rows, null, 2) }]);
    });
  });

  describe('iqms_boms_where_used', () => {
    it('maps snake_case args to camelCase client params', async () => {
      const whereUsed = vi.fn().mockResolvedValue([]);
      mockClient({ explode: vi.fn(), whereUsed });

      await bomsHandler.handleCall('iqms_boms_where_used', {
        component_item: 'SCREW-2',
        max_level: 2,
      });

      expect(whereUsed).toHaveBeenCalledWith({ componentItem: 'SCREW-2', maxLevel: 2 });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        { parentItem: 'WIDGET-1', componentItem: 'SCREW-2', quantityPer: 4, uom: 'EA' },
      ];
      const whereUsed = vi.fn().mockResolvedValue(rows);
      mockClient({ explode: vi.fn(), whereUsed });

      const result = await bomsHandler.handleCall('iqms_boms_where_used', {
        component_item: 'SCREW-2',
      });

      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ explode: vi.fn(), whereUsed: vi.fn() });

    const result = await bomsHandler.handleCall('iqms_boms_nonexistent', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error (caller/server.ts maps to isError)', async () => {
    const explode = vi.fn().mockRejectedValue(new Error('ORA-00001: boom'));
    mockClient({ explode, whereUsed: vi.fn() });

    await expect(
      bomsHandler.handleCall('iqms_boms_explode', { parent_item: 'WIDGET-1' }),
    ).rejects.toThrow('ORA-00001: boom');
  });
});
