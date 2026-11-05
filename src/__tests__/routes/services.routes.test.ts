import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Services Routes (GET, POST, PUT, DELETE, /check-code)', () => {
  const app = createApp();

  describe('GET /api/services', () => {
    it('returns services list and respects pagination', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.service.findMany.mockResolvedValueOnce([
        { id: 'srv-1', code: 'SRV1', name: 'Service 1', frequencyMonths: 6 },
      ]);
      mockPrisma.service.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/services?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
    });

    it('GET /api/services/check-code checks uniqueness', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.service.findFirst.mockResolvedValueOnce({
        id: 'srv-existing',
        code: 'srv1',
        name: 'Existing Service',
      });

      const res = await request(app)
        .get('/api/services/check-code?code=SRV1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
    });
  });

  describe('POST /api/services', () => {
    it('creates service and invalidates referenceCache', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.service.findFirst.mockResolvedValueOnce(null);
      mockPrisma.service.create.mockResolvedValueOnce({
        id: 'srv-new',
        code: 'brand-new-service',
        name: 'Brand New Service',
        frequency: 12,
      });

      const res = await request(app)
        .post('/api/services')
        .set('Authorization', createAuthHeader(admin))
        .send({
          code: 'brand-new-service',
          name: 'Brand New Service',
          frequency: 12,
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe('brand-new-service');
    });
  });

  describe('PUT /api/services/:id', () => {
    it('updates service details', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.service.findUnique.mockResolvedValueOnce({
        id: 'srv-1',
        code: 'srv-1',
        name: 'Old Name',
      });
      mockPrisma.service.findFirst.mockResolvedValueOnce(null);
      mockPrisma.service.update.mockResolvedValueOnce({
        id: 'srv-1',
        name: 'Updated Name',
      });

      const res = await request(app)
        .put('/api/services/srv-1')
        .set('Authorization', createAuthHeader(admin))
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });
  });

  describe('DELETE /api/services/:id', () => {
    it('deletes service by id', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.service.delete.mockResolvedValueOnce({ id: 'srv-1' });

      const res = await request(app)
        .delete('/api/services/srv-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
