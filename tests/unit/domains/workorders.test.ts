import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workordersHandler } from '../../../src/domains/workorders.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(workorders: Partial<IqmsClient['workorders']>) {
  mockedGetClient.mockResolvedValue({ workorders } as unknown as IqmsClient);
}

describe('workordersHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_workorders_list', () => {
    it('maps all snake_case filters to camelCase client params', async () => {
      const list = vi.fn().mockResolvedValue([]);
      mockClient({ list, get: vi.fn(), create: vi.fn(), postProduction: vi.fn() });

      await workordersHandler.handleCall('iqms_workorders_list', {
        status: 'in_progress',
        customer_id: 3,
        item_number: 'WIDGET-1',
        due_before: '2026-09-01',
        due_after: '2026-08-01',
        limit: 50,
      });

      expect(list).toHaveBeenCalledWith({
        status: 'in_progress',
        customerId: 3,
        itemNumber: 'WIDGET-1',
        dueBefore: '2026-09-01',
        dueAfter: '2026-08-01',
        limit: 50,
      });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        {
          id: 1,
          number: 'WO-1',
          itemNumber: 'WIDGET-1',
          quantityOrdered: 100,
          quantityMade: 0,
          quantityScrapped: 0,
          status: 'open',
        },
      ];
      const list = vi.fn().mockResolvedValue(rows);
      mockClient({ list, get: vi.fn(), create: vi.fn(), postProduction: vi.fn() });

      const result = await workordersHandler.handleCall('iqms_workorders_list', {});

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  describe('iqms_workorders_get', () => {
    it('passes the numeric id through to the client', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 42,
        number: 'WO-42',
        itemNumber: 'WIDGET-1',
        quantityOrdered: 10,
        quantityMade: 0,
        quantityScrapped: 0,
        status: 'open',
      });
      mockClient({ list: vi.fn(), get, create: vi.fn(), postProduction: vi.fn() });

      await workordersHandler.handleCall('iqms_workorders_get', { id: 42 });

      expect(get).toHaveBeenCalledWith(42);
    });

    it('maps a found work order into JSON text content', async () => {
      const row = {
        id: 42,
        number: 'WO-42',
        itemNumber: 'WIDGET-1',
        quantityOrdered: 10,
        quantityMade: 0,
        quantityScrapped: 0,
        status: 'open',
        routings: [{ step: 1, workCenter: 'CNC-1' }],
      };
      const get = vi.fn().mockResolvedValue(row);
      mockClient({ list: vi.fn(), get, create: vi.fn(), postProduction: vi.fn() });

      const result = await workordersHandler.handleCall('iqms_workorders_get', { id: 42 });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(row);
    });

    it('returns an isError result with a not-found message when the client returns null', async () => {
      const get = vi.fn().mockResolvedValue(null);
      mockClient({ list: vi.fn(), get, create: vi.fn(), postProduction: vi.fn() });

      const result = await workordersHandler.handleCall('iqms_workorders_get', { id: 999 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Work order 999 not found');
    });
  });

  describe('iqms_workorders_create', () => {
    it('maps snake_case fields to camelCase client params', async () => {
      const create = vi.fn().mockResolvedValue({});
      mockClient({ list: vi.fn(), get: vi.fn(), create, postProduction: vi.fn() });

      await workordersHandler.handleCall('iqms_workorders_create', {
        item_number: 'WIDGET-1',
        quantity: 25,
        due_date: '2026-09-01',
        customer_id: 3,
        notes: 'rush order',
      });

      expect(create).toHaveBeenCalledWith({
        itemNumber: 'WIDGET-1',
        quantity: 25,
        dueDate: '2026-09-01',
        customerId: 3,
        notes: 'rush order',
      });
    });

    it('maps the created work order response into JSON text content', async () => {
      const created = {
        id: 7,
        number: 'WO-7',
        itemNumber: 'WIDGET-1',
        quantityOrdered: 25,
        quantityMade: 0,
        quantityScrapped: 0,
        status: 'open',
      };
      const create = vi.fn().mockResolvedValue(created);
      mockClient({ list: vi.fn(), get: vi.fn(), create, postProduction: vi.fn() });

      const result = await workordersHandler.handleCall('iqms_workorders_create', {
        item_number: 'WIDGET-1',
        quantity: 25,
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(created);
    });
  });

  describe('iqms_workorders_post_production', () => {
    it('maps all snake_case fields to camelCase client params', async () => {
      const postProduction = vi.fn().mockResolvedValue(undefined);
      mockClient({ list: vi.fn(), get: vi.fn(), create: vi.fn(), postProduction });

      await workordersHandler.handleCall('iqms_workorders_post_production', {
        work_order_id: 7,
        quantity_made: 20,
        quantity_scrapped: 2,
        scrap_reason_code: 'DEFECT',
        posted_at: '2026-08-28T12:00:00Z',
      });

      expect(postProduction).toHaveBeenCalledWith({
        workOrderId: 7,
        quantityMade: 20,
        quantityScrapped: 2,
        scrapReasonCode: 'DEFECT',
        postedAt: '2026-08-28T12:00:00Z',
      });
    });

    it('returns a static confirmation message rather than echoing the (void) client response', async () => {
      const postProduction = vi.fn().mockResolvedValue(undefined);
      mockClient({ list: vi.fn(), get: vi.fn(), create: vi.fn(), postProduction });

      const result = await workordersHandler.handleCall('iqms_workorders_post_production', {
        work_order_id: 7,
        quantity_made: 20,
      });

      expect(result).toEqual({ content: [{ type: 'text', text: 'Production posted' }] });
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ list: vi.fn(), get: vi.fn(), create: vi.fn(), postProduction: vi.fn() });

    const result = await workordersHandler.handleCall('iqms_workorders_bogus', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('DriverNotConfiguredError: webapi'));
    mockClient({ list: vi.fn(), get: vi.fn(), create, postProduction: vi.fn() });

    await expect(
      workordersHandler.handleCall('iqms_workorders_create', {
        item_number: 'WIDGET-1',
        quantity: 1,
      }),
    ).rejects.toThrow('DriverNotConfiguredError: webapi');
  });
});
