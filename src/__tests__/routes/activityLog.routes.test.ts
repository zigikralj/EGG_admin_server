import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('ActivityLog Routes (GET, POST, DELETE, /analytics, /monthly-stats)', () => {
  const app = createApp();

  describe('GET /api/activity-logs', () => {
    it('returns activity logs list for Administrator', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.activityLog.findMany.mockResolvedValueOnce([
        { id: 'log-1', userId: admin.id, action: 'CREATE', details: '{}' },
      ]);

      const res = await request(app)
        .get('/api/activity-logs')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
    });

    it('denies non-admin users from viewing activity logs (403)', async () => {
      const user = createTestUser({ role: 'User', permissions: { activityLogs: { view: false } } });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const res = await request(app)
        .get('/api/activity-logs')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/activity-logs/status and PATCH /status', () => {
    it('returns logging status and toggles it', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.systemSetting.upsert.mockResolvedValue({});

      const resGet = await request(app)
        .get('/api/activity-logs/status')
        .set('Authorization', createAuthHeader(admin));
      expect(resGet.status).toBe(200);
      expect(resGet.body).toHaveProperty('enabled');

      const resPatch = await request(app)
        .patch('/api/activity-logs/status')
        .set('Authorization', createAuthHeader(admin))
        .send({ enabled: true });
      expect(resPatch.status).toBe(200);
      expect(resPatch.body).toHaveProperty('enabled');
    });
  });

  describe('POST /api/activity-logs (Batch Ingestion)', () => {
    it('accepts array of activity log entries', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);

      const res = await request(app)
        .post('/api/activity-logs')
        .set('Authorization', createAuthHeader(admin))
        .send([
          { type: 'PAGE_VIEW', path: '/projects' },
          { type: 'ONLINE', path: '/projects/new' },
        ]);

      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(2);
    });
  });

  describe('DELETE /api/activity-logs/clear-all and /:id', () => {
    it('clears all activity logs when requested by Administrator', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.activityLog.deleteMany.mockResolvedValueOnce({ count: 100 });

      const res = await request(app)
        .delete('/api/activity-logs/clear-all')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(100);
    });
  });
});
