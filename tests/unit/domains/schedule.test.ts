import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleHandler } from '../../../src/domains/schedule.js';
import { getClient } from '../../../src/utils/client.js';
import type { IqmsClient } from '@wyre-technology/node-iqms';

vi.mock('../../../src/utils/client.js', () => ({
  getClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getClient);

function mockClient(schedule: Partial<IqmsClient['schedule']>) {
  mockedGetClient.mockResolvedValue({ schedule } as unknown as IqmsClient);
}

describe('scheduleHandler', () => {
  beforeEach(() => {
    mockedGetClient.mockReset();
  });

  describe('iqms_schedule_capacity', () => {
    it('maps all snake_case filters to camelCase client params', async () => {
      const capacity = vi.fn().mockResolvedValue([]);
      mockClient({ capacity });

      await scheduleHandler.handleCall('iqms_schedule_capacity', {
        work_center: 'CNC-1',
        start_date: '2026-08-01',
        end_date: '2026-08-31',
        limit: 100,
      });

      expect(capacity).toHaveBeenCalledWith({
        workCenter: 'CNC-1',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        limit: 100,
      });
    });

    it('maps the resource response into JSON text content', async () => {
      const rows = [
        {
          workCenter: 'CNC-1',
          workOrderId: 1,
          workOrderNumber: 'WO-1',
          itemNumber: 'WIDGET-1',
          scheduledStart: '2026-08-01T08:00:00Z',
          scheduledEnd: '2026-08-01T16:00:00Z',
        },
      ];
      const capacity = vi.fn().mockResolvedValue(rows);
      mockClient({ capacity });

      const result = await scheduleHandler.handleCall('iqms_schedule_capacity', {
        start_date: '2026-08-01',
        end_date: '2026-08-31',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(rows);
    });
  });

  it('returns an isError result for an unknown tool name', async () => {
    mockClient({ capacity: vi.fn() });

    const result = await scheduleHandler.handleCall('iqms_schedule_bogus', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('propagates a rejected client call as a thrown error', async () => {
    const capacity = vi.fn().mockRejectedValue(new Error('ORA-99999'));
    mockClient({ capacity });

    await expect(
      scheduleHandler.handleCall('iqms_schedule_capacity', {
        start_date: '2026-08-01',
        end_date: '2026-08-31',
      }),
    ).rejects.toThrow('ORA-99999');
  });
});
