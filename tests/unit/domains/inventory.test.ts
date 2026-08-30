import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inventoryHandler } from '../../../src/domains/inventory.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(inventory: Partial<IqmsClient['inventory']>) {
  mockedGetClient.mockResolvedValue({ inventory } as unknown as IqmsClient);
}

describe('inventoryHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_inventory_onhand', () => {
    it('maps all snake_case filters to camelCase client params', async () => {
      const onHand = vi.fn().mockResolvedValue([]);
      mockClient({ onHand, trace: vi.fn(), adjust: vi.fn() });

      await inventoryHandler.handleCall('iqms_inventory_onhand', {
        item_number: 'WIDGET-1',
        location: 'MAIN',
        lot_number: 'LOT-9',
        hide_zero_on_hand: false,
        limit: 25,
      });

      expect(onHand).toHaveBeenCalledWith({
        itemNumber: 'WIDGET-1',
        location: 'MAIN',
        lotNumber: 'LOT-9',
        hideZeroOnHand: false,
        limit: 25,
      });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        { itemNumber: 'WIDGET-1', location: 'MAIN', quantityOnHand: 10, uom: 'EA' },
      ];
      const onHand = vi.fn().mockResolvedValue(rows);
      mockClient({ onHand, trace: vi.fn(), adjust: vi.fn() });

      const result = await inventoryHandler.handleCall('iqms_inventory_onhand', {});

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  describe('iqms_inventory_lot_trace', () => {
    it('maps lot_number/direction to the client params', async () => {
      const trace = vi.fn().mockResolvedValue([]);
      mockClient({ onHand: vi.fn(), trace, adjust: vi.fn() });

      await inventoryHandler.handleCall('iqms_inventory_lot_trace', {
        lot_number: 'LOT-9',
        direction: 'where_produced',
      });

      expect(trace).toHaveBeenCalledWith({ lotNumber: 'LOT-9', direction: 'where_produced' });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [{ lotNumber: 'LOT-9', itemNumber: 'WIDGET-1', quantity: 5, uom: 'EA' }];
      const trace = vi.fn().mockResolvedValue(rows);
      mockClient({ onHand: vi.fn(), trace, adjust: vi.fn() });

      const result = await inventoryHandler.handleCall('iqms_inventory_lot_trace', {
        lot_number: 'LOT-9',
      });

      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  describe('iqms_inventory_adjust', () => {
    it('maps all snake_case fields to camelCase client params', async () => {
      const adjust = vi.fn().mockResolvedValue(undefined);
      mockClient({ onHand: vi.fn(), trace: vi.fn(), adjust });

      await inventoryHandler.handleCall('iqms_inventory_adjust', {
        item_number: 'WIDGET-1',
        location: 'MAIN',
        lot_number: 'LOT-9',
        quantity_delta: -5,
        reason_code: 'CYCLE_COUNT',
        notes: 'adjustment note',
      });

      expect(adjust).toHaveBeenCalledWith({
        itemNumber: 'WIDGET-1',
        location: 'MAIN',
        lotNumber: 'LOT-9',
        quantityDelta: -5,
        reasonCode: 'CYCLE_COUNT',
        notes: 'adjustment note',
      });
    });

    it('returns a static confirmation message rather than echoing the (void) client response', async () => {
      const adjust = vi.fn().mockResolvedValue(undefined);
      mockClient({ onHand: vi.fn(), trace: vi.fn(), adjust });

      const result = await inventoryHandler.handleCall('iqms_inventory_adjust', {
        item_number: 'WIDGET-1',
        location: 'MAIN',
        quantity_delta: 1,
        reason_code: 'CYCLE_COUNT',
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Inventory adjustment posted' }],
      });
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ onHand: vi.fn(), trace: vi.fn(), adjust: vi.fn() });

    const result = await inventoryHandler.handleCall('iqms_inventory_bogus', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error', async () => {
    const adjust = vi.fn().mockRejectedValue(new Error('DriverNotConfiguredError'));
    mockClient({ onHand: vi.fn(), trace: vi.fn(), adjust });

    await expect(
      inventoryHandler.handleCall('iqms_inventory_adjust', {
        item_number: 'WIDGET-1',
        location: 'MAIN',
        quantity_delta: 1,
        reason_code: 'CYCLE_COUNT',
      }),
    ).rejects.toThrow('DriverNotConfiguredError');
  });
});
