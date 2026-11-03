import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('SystemSettings Routes (GET, PUT)', () => {
  const app = createApp();

  describe('GET /api/system-settings', () => {
    it('returns all system settings as key-value map', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.systemSetting.findMany.mockResolvedValueOnce([
        { key: 'waste_disposal_service_id', value: 'srv-waste-123' },
      ]);

      const res = await request(app)
        .get('/api/system-settings')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        waste_disposal_service_id: 'srv-waste-123',
      });
    });

    it('GET /api/system-settings/:key returns single setting', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.systemSetting.findUnique.mockResolvedValueOnce({
        key: 'waste_disposal_service_id',
        value: 'srv-waste-123',
      });

      const res = await request(app)
        .get('/api/system-settings/waste_disposal_service_id')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        key: 'waste_disposal_service_id',
        value: 'srv-waste-123',
      });
    });
  });

  describe('PUT /api/system-settings/:key', () => {
    it('allows Administrator to update setting (e.g. waste_disposal_service_id)', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.systemSetting.upsert.mockResolvedValueOnce({
        key: 'waste_disposal_service_id',
        value: 'srv-new-waste',
      });

      const res = await request(app)
        .put('/api/system-settings/waste_disposal_service_id')
        .set('Authorization', createAuthHeader(admin))
        .send({ value: 'srv-new-waste' });

      expect(res.status).toBe(200);
      expect(res.body.value).toBe('srv-new-waste');
    });

    it('denies non-Administrator from modifying settings (403)', async () => {
      const regularUser = createTestUser({ role: 'User', permissions: { all: false } });
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);

      const res = await request(app)
        .put('/api/system-settings/waste_disposal_service_id')
        .set('Authorization', createAuthHeader(regularUser))
        .send({ value: 'srv-denied' });

      expect(res.status).toBe(403);
    });
  });
});
