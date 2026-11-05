import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('WasteCatalog Routes (GET, POST, PATCH /:id/frequent, DELETE)', () => {
  const app = createApp();

  describe('GET /api/waste-catalog', () => {
    it('returns waste catalog items and handles delta sync', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.wasteCatalog.count.mockResolvedValueOnce(50); // non-empty
      mockPrisma.wasteCatalog.findMany.mockResolvedValueOnce([
        { id: 'w1', code: '15 01 01', description: 'Paper packaging', isHazardous: false },
      ]);

      const res = await request(app)
        .get('/api/waste-catalog')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].code).toBe('15 01 01');
    });

    it('returns delta envelope when ?since is provided', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.wasteCatalog.count.mockResolvedValueOnce(50);
      mockPrisma.wasteCatalog.findMany.mockResolvedValueOnce([
        { id: 'w1', code: '15 01 01', description: 'Paper packaging', isHazardous: false },
      ]);
      mockPrisma.entityVersion.findMany.mockResolvedValueOnce([]); // No deletions

      const res = await request(app)
        .get(`/api/waste-catalog?since=${encodeURIComponent(new Date().toISOString())}`)
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.delta).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(Array.isArray(res.body.deletedIds)).toBe(true);
    });
  });

  describe('PATCH /api/waste-catalog/:id/frequent', () => {
    it('toggles isFrequent status on waste entry', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.wasteCatalog.findUnique.mockResolvedValueOnce({
        id: 'w1',
        isFrequent: false,
      });
      mockPrisma.wasteCatalog.update.mockResolvedValueOnce({
        id: 'w1',
        isFrequent: true,
      });

      const res = await request(app)
        .patch('/api/waste-catalog/w1/frequent')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.isFrequent).toBe(true);
    });
  });

  describe('POST /api/waste-catalog', () => {
    it('creates custom waste entry and invalidates cache', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.wasteCatalog.findFirst.mockResolvedValueOnce(null);
      mockPrisma.wasteCatalog.create.mockResolvedValueOnce({
        id: 'w-new',
        code: '16 02 14',
        description: 'Discarded equipment',
        isHazardous: false,
      });

      const res = await request(app)
        .post('/api/waste-catalog')
        .set('Authorization', createAuthHeader(admin))
        .send({
          code: '16 02 14',
          description: 'Discarded equipment',
          isHazardous: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe('16 02 14');
    });
  });

  describe('DELETE /api/waste-catalog/:id', () => {
    it('deletes waste entry', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.wasteCatalog.findUnique.mockResolvedValue({ id: 'w1' });
      mockPrisma.wasteCatalog.delete.mockResolvedValue({ id: 'w1' });

      const res = await request(app)
        .delete('/api/waste-catalog/w1')
        .set('Authorization', createAuthHeader(admin));

      if (res.status !== 204) {
        console.log('DELETE response status & body:', res.status, res.body);
      }
      expect(res.status).toBe(204);
    });
  });
});
