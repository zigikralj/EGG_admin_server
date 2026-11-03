import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Categories Routes (GET, POST, PUT, DELETE)', () => {
  const app = createApp();

  describe('GET /api/categories', () => {
    it('returns categories list and supports search', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.category.findMany.mockResolvedValueOnce([
        { id: 'cat-1', code: 'env', name: 'Ekologija', description: 'Eco' },
        { id: 'cat-2', code: 'waste', name: 'Otpad', description: 'Waste' },
      ]);

      const res = await request(app)
        .get('/api/categories?search=eko')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Ekologija');
    });

    it('supports pagination on categories', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.category.findMany.mockResolvedValueOnce([
        { id: 'cat-1', code: 'env', name: 'Ekologija' },
      ]);

      const res = await request(app)
        .get('/api/categories?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
    });
  });

  describe('POST /api/categories', () => {
    it('creates new category', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.category.findUnique.mockResolvedValueOnce(null);
      mockPrisma.category.create.mockResolvedValueOnce({
        id: 'cat-2',
        code: 'waste',
        name: 'Otpad',
      });

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', createAuthHeader(admin))
        .send({ code: 'waste', name: 'Otpad' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Otpad');
    });

    it('returns 400 when code or name is missing', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', createAuthHeader(admin))
        .send({ code: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Category code and name are required');
    });
  });

  describe('PUT /api/categories/:id', () => {
    it('updates category', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.category.findFirst.mockResolvedValueOnce(null);
      mockPrisma.category.update.mockResolvedValueOnce({
        id: 'cat-1',
        code: 'env',
        name: 'New Name',
      });

      const res = await request(app)
        .put('/api/categories/cat-1')
        .set('Authorization', createAuthHeader(admin))
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
    });
  });

  describe('DELETE /api/categories/:id', () => {
    it('deletes category returning 204', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.category.delete.mockResolvedValueOnce({ id: 'cat-1' });

      const res = await request(app)
        .delete('/api/categories/cat-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(204);
    });
  });
});
