import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('History Routes (GET /:entityType/:id, /diff, /versions/:v, /changesets/:id, POST /restore/:v)', () => {
  const app = createApp();

  describe('GET /api/history/:entityType/:id', () => {
    it('returns timeline of entity versions', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
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
          createdAt: new Date(),
          changeSet: {
            id: 'cs-1',
            userId: admin.id,
            userName: admin.name,
            source: 'api',
            reason: null,
            route: '/api/projects',
            method: 'POST',
            createdAt: new Date(),
          },
        },
      ]);
      mockPrisma.entityVersion.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/history/projects/proj-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('versions');
      expect(res.body.versions).toHaveLength(1);
    });

    it('returns 400 when entity type is unsupported', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const res = await request(app)
        .get('/api/history/unsupportedType/123')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unsupported entity type');
    });
  });

  describe('GET /api/history/:entityType/:id/versions/:v', () => {
    it('returns reconstructed snapshot of version', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
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

      const res = await request(app)
        .get('/api/history/projects/proj-1/versions/1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.state.name).toBe('Rebuilt Project');
    });
  });

  describe('GET /api/history/changesets/:id', () => {
    it('returns transaction-level changeset details', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.changeSet.findUnique.mockResolvedValueOnce({
        id: 'cs-1',
        userId: admin.id,
        userName: admin.name,
        route: '/api/projects',
        method: 'POST',
        versions: [],
      });

      const res = await request(app)
        .get('/api/history/changesets/cs-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('cs-1');
    });
  });

  describe('POST /api/history/:entityType/:id/restore/:v', () => {
    it('restores entity version when authorized', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      // Rebuild target version 1
      mockPrisma.entityVersion.findFirst.mockResolvedValueOnce({
        id: BigInt(1),
        entityType: 'Project',
        entityId: 'proj-1',
        version: 1,
        op: 'I',
        kind: 'S',
        createdAt: new Date(),
        data: { name: 'Restored Version Name' },
      });
      mockPrisma.entityVersion.findMany.mockResolvedValue([]);
      mockPrisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1' });
      mockPrisma.project.update.mockResolvedValueOnce({
        id: 'proj-1',
        name: 'Restored Version Name',
      });

      const res = await request(app)
        .post('/api/history/projects/proj-1/restore/1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.restored).toBe(true);
    });
  });
});
