import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesOrdersHandler } from '../../../src/domains/sales-orders.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(salesOrders: Partial<IqmsClient['salesOrders']>) {
  mockedGetClient.mockResolvedValue({ salesOrders } as unknown as IqmsClient);
}

describe('salesOrdersHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_sales_orders_list', () => {
    it('maps all snake_case filters to camelCase client params', async () => {
      const list = vi.fn().mockResolvedValue([]);
      mockClient({ list });

      await salesOrdersHandler.handleCall('iqms_sales_orders_list', {
        status: 'shipped',
        customer_id: 7,
        ship_before: '2026-09-01',
        ship_after: '2026-08-01',
        limit: 5,
      });

      expect(list).toHaveBeenCalledWith({
        status: 'shipped',
        customerId: 7,
        shipBefore: '2026-09-01',
        shipAfter: '2026-08-01',
        limit: 5,
      });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        { id: 1, number: 'SO-1', customerId: 7, orderDate: '2026-08-01', status: 'open' },
      ];
      const list = vi.fn().mockResolvedValue(rows);
      mockClient({ list });

      const result = await salesOrdersHandler.handleCall('iqms_sales_orders_list', {});

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ list: vi.fn() });

    const result = await salesOrdersHandler.handleCall('iqms_sales_orders_bogus', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error', async () => {
    const list = vi.fn().mockRejectedValue(new Error('ORA-54321'));
    mockClient({ list });

    await expect(salesOrdersHandler.handleCall('iqms_sales_orders_list', {})).rejects.toThrow(
      'ORA-54321',
    );
  });
});
