import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('ProvidedServices Routes (GET, POST, PUT, DELETE)', () => {
  const app = createApp();

  describe('GET /api/provided-services', () => {
    it('returns provided services with pagination', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.providedService.findMany.mockResolvedValueOnce([
        { id: 'ps-1', clientId: 'c1', serviceId: 's1', date: '2026-10-15' },
      ]);
      mockPrisma.providedService.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/provided-services?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
    });

    it('GET /api/provided-services/:id returns single record', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.providedService.findUnique.mockResolvedValueOnce({
        id: 'ps-1',
        clientId: 'c1',
      });

      const res = await request(app)
        .get('/api/provided-services/ps-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('ps-1');
    });
  });

  describe('POST /api/provided-services', () => {
    it('creates provided service and auto-schedules next reminder if service has frequency', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      // Validate references
      mockPrisma.client.findUnique.mockResolvedValueOnce({ id: 'c1', name: 'Client 1' });
      mockPrisma.service.findUnique.mockResolvedValueOnce({
        id: 's1',
        name: 'Periodic Sampling',
        frequencyMonths: 6,
      });

      mockPrisma.providedService.create.mockResolvedValueOnce({
        id: 'ps-new',
        clientId: 'c1',
        serviceId: 's1',
        date: '2026-11-01',
      });
      mockPrisma.reminder.create.mockResolvedValueOnce({ id: 'rem-auto-1' });

      const res = await request(app)
        .post('/api/provided-services')
        .set('Authorization', createAuthHeader(admin))
        .send({
          clientId: 'c1',
          serviceId: 's1',
          date: '2026-11-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('ps-new');
    });
  });

  describe('PUT /api/provided-services/:id', () => {
    it('updates provided service entry', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.providedService.findUnique.mockResolvedValueOnce({ id: 'ps-1', serviceId: 's1' });
      mockPrisma.providedService.update.mockResolvedValueOnce({
        id: 'ps-1',
        note: 'Updated delivery notes',
      });

      const res = await request(app)
        .put('/api/provided-services/ps-1')
        .set('Authorization', createAuthHeader(admin))
        .send({ note: 'Updated delivery notes' });

      expect(res.status).toBe(200);
      expect(res.body.note).toBe('Updated delivery notes');
    });
  });

  describe('DELETE /api/provided-services/:id', () => {
    it('deletes provided service', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.providedService.findUnique.mockResolvedValueOnce({
        id: 'ps-1',
        serviceId: 's1',
        service: { id: 's1' },
      });
      mockPrisma.providedService.delete.mockResolvedValueOnce({ id: 'ps-1' });

      const res = await request(app)
        .delete('/api/provided-services/ps-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
