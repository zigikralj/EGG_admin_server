import { describe, it, expect } from 'vitest';
import { getActivityAnalytics } from '../../services/activityAnalytics.service';
import { mockPrisma } from '../helpers/prismaMock';
import { USER_STATUSES } from '../../constants';

describe('ActivityAnalytics Service (getActivityAnalytics)', () => {
  it('processes raw SQL aggregations into structured analytics object', async () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-31T23:59:59Z');

    mockPrisma.$queryRaw.mockImplementation((query: any) => {
      const qStr = String(query?.strings?.join(' ') || query || '');

      if (qStr.includes('activeUsers') && qStr.includes('sessions') && !qStr.includes('bucket')) {
        return Promise.resolve([
          {
            activeUsers: 5,
            sessions: 20,
            pageViews: 100,
            actions: 40,
            trackedSeconds: 3600,
          },
        ]);
      }
      if (qStr.includes('date_trunc')) {
        return Promise.resolve([
          {
            bucket: '2026-10-01',
            activeUsers: 2,
            sessions: 4,
            trackedSeconds: 600,
            pageViews: 10,
            actions: 5,
          },
        ]);
      }
      if (qStr.includes('path') && qStr.includes('views')) {
        return Promise.resolve([
          {
            path: '/projects',
            views: 50,
            totalSeconds: 1800,
            uniqueUsers: 4,
            sessions: 15,
          },
        ]);
      }
      if (qStr.includes('action') && qStr.includes('model')) {
        return Promise.resolve([
          {
            model: 'Project',
            action: 'create',
            count: 10,
            uniqueUsers: 2,
          },
        ]);
      }
      if (qStr.includes('activeDays')) {
        return Promise.resolve([
          {
            userId: 'u1',
            sessions: 10,
            activeDays: 5,
            trackedSeconds: 1200,
            pageViews: 30,
            actions: 12,
            lastActive: new Date('2026-10-30T10:00:00Z'),
          },
        ]);
      }
      if (qStr.includes('dow') && qStr.includes('hour')) {
        return Promise.resolve([
          {
            dow: 1,
            hour: 14,
            trackedSeconds: 300,
            actions: 8,
          },
        ]);
      }
      if (qStr.includes('sessionDurationBuckets') || qStr.includes('bucket')) {
        return Promise.resolve([
          { bucket: '1-5m', count: 12 },
        ]);
      }
      return Promise.resolve([]);
    });

    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: 'u1', name: 'Alice Admin', role: 'Administrator', status: USER_STATUSES.APPROVED, isApproved: true },
    ]);

    const result = await getActivityAnalytics(mockPrisma as any, {
      from,
      to,
      granularity: 'day',
      tz: 'Europe/Belgrade',
      compare: false,
    });

    expect(result).toHaveProperty('totals');
    expect(result.totals.activeUsers).toBe(5);
    expect(result.totals.sessions).toBe(20);
    expect(result.totals.trackedSeconds).toBe(3600);
    expect(result.previousTotals).toBeNull();
    expect(result.timeline).toBeInstanceOf(Array);
    expect(result.pages).toBeInstanceOf(Array);
    expect(result.actions).toBeInstanceOf(Array);
    expect(result.totalRegisteredActiveUsers).toBe(1);
  });

  it('handles empty activity records gracefully without NaN values', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValueOnce([]);

    const result = await getActivityAnalytics(mockPrisma as any, {
      from: new Date('2026-10-01'),
      to: new Date('2026-10-02'),
      granularity: 'day',
      tz: 'UTC',
      compare: true,
    });

    expect(result.totals.activeUsers).toBe(0);
    expect(result.totals.avgSessionSeconds).toBe(0);
    expect(result.totals.avgPagesPerSession).toBe(0);
    expect(result.previousTotals).toBeNull();
    expect(result.totalRegisteredActiveUsers).toBe(0);
  });
});
