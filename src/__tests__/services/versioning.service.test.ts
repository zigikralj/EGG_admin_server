import { describe, it, expect } from 'vitest';
import {
  normalizeEntityType,
  getEntityTimeline,
  rebuildEntityVersion,
} from '../../services/versioning.service';
import { mockPrisma } from '../helpers/prismaMock';

describe('versioning.service', () => {
  describe('normalizeEntityType', () => {
    it('normalizes common entity names and handles pluralization/casing', () => {
      expect(normalizeEntityType('projects')).toBe('Project');
      expect(normalizeEntityType('Project')).toBe('Project');
      expect(normalizeEntityType('invoices')).toBe('Invoice');
      expect(normalizeEntityType('client')).toBe('Client');
      expect(normalizeEntityType('unknownEntity')).toBeNull();
    });
  });

  describe('getEntityTimeline', () => {
    it('retrieves EntityVersion list for given entity', async () => {
      mockPrisma.entityVersion.findMany.mockResolvedValueOnce([
        {
          id: BigInt(1),
          changeSetId: 'cs-1',
          entityType: 'Project',
          entityId: 'proj-1',
          version: 1,
          op: 'I',
          kind: 'S',
          changedFields: ['name'],
          parentType: null,
          parentId: null,
          createdAt: new Date(),
          changeSet: {
            id: 'cs-1',
            userId: 'user-1',
            userName: 'Admin',
            source: 'api',
            reason: null,
            route: '/api/projects',
            method: 'POST',
            createdAt: new Date(),
          },
        },
      ]);
      mockPrisma.entityVersion.count.mockResolvedValueOnce(1);

      const timeline = await getEntityTimeline('Project', 'proj-1');
      expect(timeline.total).toBe(1);
      expect(timeline.versions).toHaveLength(1);
      expect(timeline.versions[0].version).toBe(1);
      expect(timeline.versions[0].changeSet.userName).toBe('Admin');
    });
  });

  describe('rebuildEntityVersion', () => {
    it('returns state snapshot for version 1 insert', async () => {
      mockPrisma.entityVersion.findFirst.mockResolvedValueOnce({
        id: BigInt(1),
        entityType: 'Project',
        entityId: 'proj-1',
        version: 1,
        op: 'I',
        kind: 'S',
        createdAt: new Date(),
        data: { name: 'Rebuilt Project' },
      });
      mockPrisma.entityVersion.findMany.mockResolvedValueOnce([]);

      const res = await rebuildEntityVersion('Project', 'proj-1', 1);
      expect(res?.state).toEqual({ name: 'Rebuilt Project' });
      expect(res?.version).toBe(1);
      expect(res?.entityType).toBe('Project');
    });
  });
});
