import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Permits Routes (GET, POST, PUT, DELETE)', () => {
  const app = createApp();

  describe('GET /api/permits', () => {
    it('returns permits and supports pagination', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.permit.findMany.mockResolvedValueOnce([
        { id: 'p1', permitNumber: '19-00-1234', permitTypes: ['Skladištenje'] },
      ]);
      mockPrisma.permit.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/permits?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
    });

    it('GET /api/permits/:id returns permit details', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.permit.findUnique.mockResolvedValueOnce({
        id: 'p1',
        permitNumber: '19-00-1234',
        permitTypes: ['Skladištenje'],
      });

      const res = await request(app)
        .get('/api/permits/p1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.permitNumber).toBe('19-00-1234');
    });
  });

  describe('POST /api/permits', () => {
    it('creates permit with linked waste catalog items', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.permit.create.mockResolvedValueOnce({
        id: 'p-new',
        permitNumber: '20-00-5678',
        permitTypes: ['Tretman'],
        clientId: 'client-1',
        permitWastes: [],
      });
      mockPrisma.clientExtraData.upsert.mockResolvedValueOnce({});

      const res = await request(app)
        .post('/api/permits')
        .set('Authorization', createAuthHeader(admin))
        .send({
          permitNumber: '20-00-5678',
          permitTypes: ['Tretman'],
          clientId: 'client-1',
          wasteCatalogIds: ['w1', 'w2'],
        });

      expect(res.status).toBe(201);
      expect(res.body.permitNumber).toBe('20-00-5678');
    });
  });

  describe('PUT /api/permits/:id', () => {
    it('updates permit details and waste catalog linkage', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.permit.findUnique.mockResolvedValueOnce({
        id: 'p1',
        permitNumber: '19-00-1234',
        clientId: 'client-1',
      });
      mockPrisma.permit.update.mockResolvedValueOnce({
        id: 'p1',
        permitNumber: '19-00-1234-REV',
        clientId: 'client-1',
        permitTypes: ['Skladištenje'],
      });

      const res = await request(app)
        .put('/api/permits/p1')
        .set('Authorization', createAuthHeader(admin))
        .send({ permitNumber: '19-00-1234-REV' });

      expect(res.status).toBe(200);
      expect(res.body.permitNumber).toBe('19-00-1234-REV');
    });
  });

  describe('DELETE /api/permits/:id', () => {
    it('deletes permit', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.permit.findUnique.mockResolvedValueOnce({
        id: 'p1',
        clientId: 'client-1',
      });
      mockPrisma.permit.delete.mockResolvedValueOnce({ id: 'p1' });

      const res = await request(app)
        .delete('/api/permits/p1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
