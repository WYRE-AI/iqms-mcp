import { beforeEach, describe, expect, it, vi } from 'vitest';
import { qualityHandler } from '../../../src/domains/quality.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(quality: Partial<IqmsClient['quality']>) {
  mockedGetClient.mockResolvedValue({ quality } as unknown as IqmsClient);
}

describe('qualityHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_quality_ncrs', () => {
    it('maps all snake_case filters to camelCase client params', async () => {
      const ncrs = vi.fn().mockResolvedValue([]);
      mockClient({ ncrs, createNcr: vi.fn() });

      await qualityHandler.handleCall('iqms_quality_ncrs', {
        status: 'open',
        item_number: 'WIDGET-1',
        reported_after: '2026-08-01',
        reported_before: '2026-08-31',
        limit: 20,
      });

      expect(ncrs).toHaveBeenCalledWith({
        status: 'open',
        itemNumber: 'WIDGET-1',
        reportedAfter: '2026-08-01',
        reportedBefore: '2026-08-31',
        limit: 20,
      });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        { id: 1, number: 'NCR-1', status: 'open', reportedDate: '2026-08-01' },
      ];
      const ncrs = vi.fn().mockResolvedValue(rows);
      mockClient({ ncrs, createNcr: vi.fn() });

      const result = await qualityHandler.handleCall('iqms_quality_ncrs', {});

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  describe('iqms_quality_create_ncr', () => {
    it('maps snake_case fields to camelCase client params', async () => {
      const createNcr = vi.fn().mockResolvedValue({});
      mockClient({ ncrs: vi.fn(), createNcr });

      await qualityHandler.handleCall('iqms_quality_create_ncr', {
        item_number: 'WIDGET-1',
        work_order_id: 5,
        description: 'Scratched surface',
        reported_by: 'jdoe',
      });

      expect(createNcr).toHaveBeenCalledWith({
        itemNumber: 'WIDGET-1',
        workOrderId: 5,
        description: 'Scratched surface',
        reportedBy: 'jdoe',
      });
    });

    it('maps the created NCR response into JSON text content', async () => {
      const created = { id: 9, number: 'NCR-9', status: 'open', reportedDate: '2026-08-28' };
      const createNcr = vi.fn().mockResolvedValue(created);
      mockClient({ ncrs: vi.fn(), createNcr });

      const result = await qualityHandler.handleCall('iqms_quality_create_ncr', {
        description: 'Scratched surface',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(created);
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ ncrs: vi.fn(), createNcr: vi.fn() });

    const result = await qualityHandler.handleCall('iqms_quality_bogus', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error', async () => {
    const createNcr = vi.fn().mockRejectedValue(new Error('ValidationError: description required'));
    mockClient({ ncrs: vi.fn(), createNcr });

    await expect(
      qualityHandler.handleCall('iqms_quality_create_ncr', { description: 'x' }),
    ).rejects.toThrow('ValidationError: description required');
  });
});
