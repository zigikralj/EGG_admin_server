import { describe, it, expect, vi } from 'vitest';
import { parseSince, fetchDeletedIds, buildDeltaResponse, purgeOldEntityVersions } from '../../helpers/deltaSync';
import { mockPrisma } from '../helpers/prismaMock';

describe('Delta Sync Helper', () => {
  describe('parseSince', () => {
    it('returns null for undefined, null, empty string, or invalid date string', () => {
      expect(parseSince(undefined)).toBeNull();
      expect(parseSince(null)).toBeNull();
      expect(parseSince('')).toBeNull();
      expect(parseSince('not-a-date')).toBeNull();
    });

    it('parses valid ISO date string correctly when within retention', () => {
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const parsed = parseSince(recentDate);
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.toISOString()).toBe(recentDate);
    });

    it('returns null if sinceDate is older than retention (30 days)', () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      expect(parseSince(oldDate)).toBeNull();
    });
  });

  describe('buildDeltaResponse', () => {
    const items = [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }];
    const deletedIds = ['3'];

    it('returns legacy raw array when sinceDate is null', () => {
      const res = buildDeltaResponse(items, deletedIds, null);
      expect(Array.isArray(res)).toBe(true);
      expect(res).toEqual(items);
    });

    it('returns DeltaEnvelope object when sinceDate is present', () => {
      const sinceDate = new Date();
      const res = buildDeltaResponse(items, deletedIds, sinceDate);
      expect(Array.isArray(res)).toBe(false);
      expect(res).toHaveProperty('delta', true);
      expect(res).toHaveProperty('items', items);
      expect(res).toHaveProperty('deletedIds', deletedIds);
      expect(res).toHaveProperty('syncedAt');
    });
  });

  describe('fetchDeletedIds', () => {
    it('queries EntityVersion with op: D and returns array of entityIds', async () => {
      mockPrisma.entityVersion.findMany.mockResolvedValueOnce([
        { entityId: 'id-deleted-1' },
        { entityId: 'id-deleted-2' },
      ]);

      const since = new Date('2026-10-20T00:00:00.000Z');
      const deletedIds = await fetchDeletedIds('Project', since);

      expect(mockPrisma.entityVersion.findMany).toHaveBeenCalledWith({
        where: {
          entityType: 'Project',
          op: 'D',
          createdAt: { gt: since },
        },
        select: { entityId: true },
        take: 2000,
        orderBy: { createdAt: 'asc' },
      });
      expect(deletedIds).toEqual(['id-deleted-1', 'id-deleted-2']);
    });
  });

  describe('purgeOldEntityVersions', () => {
    it('executes in transactions with audit.allow_cleanup set to true and returns count of deleted versions', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
      // First call for EntityVersion returns 10, then ChangeSet returns 0
      mockPrisma.$executeRaw
        .mockResolvedValueOnce(10) // EntityVersion chunk
        .mockResolvedValueOnce(0);  // ChangeSet chunk

      const count = await purgeOldEntityVersions(30);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        "SELECT set_config('audit.allow_cleanup', 'true', true)"
      );
      expect(count).toBe(10);
    });

    it('returns 0 and catches errors if transaction fails', async () => {
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('DB failure'));

      const count = await purgeOldEntityVersions(30);
      expect(count).toBe(0);
    });
  });
});
