import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Preferences Routes (GET, PUT)', () => {
  const app = createApp();

  describe('GET /api/preferences', () => {
    it('returns key-value preferences object for auth user', async () => {
      const user = createTestUser({ id: 'pref-user' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.userPreference.findMany.mockResolvedValueOnce([
        { key: 'theme', value: 'dark' },
        { key: 'pageSize', value: '25' },
      ]);

      const res = await request(app)
        .get('/api/preferences')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        theme: 'dark',
        pageSize: 25,
      });
    });
  });

  describe('PUT /api/preferences/:key', () => {
    it('upserts preference key for current user', async () => {
      const user = createTestUser({ id: 'pref-user' });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.userPreference.upsert.mockResolvedValueOnce({
        userId: user.id,
        key: 'theme',
        value: 'light',
      });

      const res = await request(app)
        .put('/api/preferences/theme')
        .set('Authorization', createAuthHeader(user))
        .send({ value: 'light' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        key: 'theme',
        value: 'light',
      });
    });
  });
});
