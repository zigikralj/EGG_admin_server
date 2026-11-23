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

    it('denies users without activityLogs.view permission (403)', async () => {
      const user = createTestUser({ role: 'User', permissions: {} });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const res = await request(app)
        .get('/api/activity-logs')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(403);
    });

    it('allows non-admin with activityLogs.view permission to view activity logs', async () => {
      const auditor = createTestUser({ role: 'Auditor', roleLevel: 30, permissions: { activityLogs: ['view'] } });
      mockPrisma.user.findUnique.mockResolvedValue(auditor);
      mockPrisma.activityLog.findMany.mockResolvedValueOnce([
        { id: 'log-1', userId: auditor.id, action: 'CREATE', details: '{}' },
      ]);

      const res = await request(app)
        .get('/api/activity-logs')
        .set('Authorization', createAuthHeader(auditor));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /api/activity-logs/status and PATCH /status', () => {
    it('returns logging status and toggles it for users with activityLogs.configure', async () => {
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

      const nonAdminWithConfig = createTestUser({
        role: 'Ops',
        roleLevel: 30,
        permissions: { activityLogs: ['configure'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(nonAdminWithConfig);
      const resNonAdminConfig = await request(app)
        .patch('/api/activity-logs/status')
        .set('Authorization', createAuthHeader(nonAdminWithConfig))
        .send({ enabled: false });
      expect(resNonAdminConfig.status).toBe(200);

      const viewerOnly = createTestUser({
        role: 'Viewer',
        roleLevel: 20,
        permissions: { activityLogs: ['view'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(viewerOnly);
      const resDenied = await request(app)
        .patch('/api/activity-logs/status')
        .set('Authorization', createAuthHeader(viewerOnly))
        .send({ enabled: true });
      expect(resDenied.status).toBe(403);
    });
  });

  describe('GET /api/activity-logs/analytics', () => {
    it('requires activityAnalytics.view permission independently of activityLogs.view', async () => {
      const logsOnly = createTestUser({
        role: 'LogViewer',
        roleLevel: 20,
        permissions: { activityLogs: ['view'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(logsOnly);

      const resDenied = await request(app)
        .get('/api/activity-logs/analytics')
        .set('Authorization', createAuthHeader(logsOnly));
      expect(resDenied.status).toBe(403);

      const analyst = createTestUser({
        role: 'Analyst',
        roleLevel: 20,
        permissions: { activityAnalytics: ['view'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(analyst);

      const resOk = await request(app)
        .get('/api/activity-logs/analytics')
        .set('Authorization', createAuthHeader(analyst));
      expect(resOk.status).toBe(200);
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
          { type: 'LOGIN', path: '/login' },
        ]);

      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(2);
    });
  });

  describe('DELETE /api/activity-logs/clear-all and /:id', () => {
    it('allows users with activityLogs.delete and rejects users without it', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.activityLog.deleteMany.mockResolvedValueOnce({ count: 100 });

      const res = await request(app)
        .delete('/api/activity-logs/clear-all')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(100);

      const nonAdminWithDelete = createTestUser({
        role: 'Cleaner',
        roleLevel: 25,
        permissions: { activityLogs: ['delete'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(nonAdminWithDelete);
      mockPrisma.activityLog.deleteMany.mockResolvedValueOnce({ count: 5 });
      const resCleaner = await request(app)
        .delete('/api/activity-logs/clear-all')
        .set('Authorization', createAuthHeader(nonAdminWithDelete));
      expect(resCleaner.status).toBe(200);

      const viewerOnly = createTestUser({
        role: 'Viewer',
        roleLevel: 20,
        permissions: { activityLogs: ['view'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(viewerOnly);
      const resDenied = await request(app)
        .delete('/api/activity-logs/clear-all')
        .set('Authorization', createAuthHeader(viewerOnly));
      expect(resDenied.status).toBe(403);
    });
  });
});
