import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Clients Routes (GET, POST, PUT, DELETE)', () => {
  const app = createApp();

  describe('GET /api/clients', () => {
    it('returns paginated client list and supports delta sync', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.client.findMany.mockResolvedValueOnce([
        { id: 'c1', name: 'Client A', pib: '111222333' },
      ]);
      mockPrisma.client.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/clients?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('returns delta envelope when ?since is provided', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.client.findMany.mockResolvedValueOnce([
        { id: 'c1', name: 'Client A' },
      ]);
      mockPrisma.entityVersion.findMany.mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/clients?since=${encodeURIComponent(new Date().toISOString())}`)
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.delta).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('POST /api/clients', () => {
    it('creates client with extra data for permit linkage', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.client.create.mockResolvedValueOnce({
        id: 'c-new',
        name: 'Eco Industry d.o.o.',
        pib: '123456789',
        extraData: { permitId: 'permit-1' },
      });

      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', createAuthHeader(admin))
        .send({
          name: 'Eco Industry d.o.o.',
          pib: '123456789',
          permitId: 'permit-1',
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Eco Industry d.o.o.');
    });
  });

  describe('PUT /api/clients/:id', () => {
    it('updates client information', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.client.update.mockResolvedValueOnce({
        id: 'c1',
        name: 'Eco Industry Updated',
      });

      const res = await request(app)
        .put('/api/clients/c1')
        .set('Authorization', createAuthHeader(admin))
        .send({ name: 'Eco Industry Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Eco Industry Updated');
    });
  });

  describe('DELETE /api/clients/:id', () => {
    it('deletes client by id', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.client.delete.mockResolvedValueOnce({ id: 'c1' });

      const res = await request(app)
        .delete('/api/clients/c1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
