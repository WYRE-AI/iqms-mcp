import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purchaseOrdersHandler } from '../../../src/domains/purchase-orders.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(purchaseOrders: Partial<IqmsClient['purchaseOrders']>) {
  mockedGetClient.mockResolvedValue({ purchaseOrders } as unknown as IqmsClient);
}

describe('purchaseOrdersHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_purchase_orders_list', () => {
    it('maps all snake_case filters to camelCase client params', async () => {
      const list = vi.fn().mockResolvedValue([]);
      mockClient({ list });

      await purchaseOrdersHandler.handleCall('iqms_purchase_orders_list', {
        status: 'open',
        supplier_id: 42,
        expected_before: '2026-09-01',
        expected_after: '2026-08-01',
        limit: 10,
      });

      expect(list).toHaveBeenCalledWith({
        status: 'open',
        supplierId: 42,
        expectedBefore: '2026-09-01',
        expectedAfter: '2026-08-01',
        limit: 10,
      });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        {
          id: 1,
          number: 'PO-1',
          supplierId: 42,
          orderDate: '2026-08-01',
          status: 'open',
        },
      ];
      const list = vi.fn().mockResolvedValue(rows);
      mockClient({ list });

      const result = await purchaseOrdersHandler.handleCall('iqms_purchase_orders_list', {});

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ list: vi.fn() });

    const result = await purchaseOrdersHandler.handleCall('iqms_purchase_orders_bogus', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error', async () => {
    const list = vi.fn().mockRejectedValue(new Error('ORA-12345'));
    mockClient({ list });

    await expect(
      purchaseOrdersHandler.handleCall('iqms_purchase_orders_list', {}),
    ).rejects.toThrow('ORA-12345');
  });
});
